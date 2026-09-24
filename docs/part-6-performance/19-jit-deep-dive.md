# Chapter 19 — JIT Compilation Deep Dive

## The JIT's Playbook

We introduced the JIT in [Chapter 7](../part-2-jvm-architecture/07-execution-engine.md). Now let's go deeper into the specific optimizations it performs. These are what make the JVM competitive with (and sometimes faster than) statically compiled languages.

## A Quick Recap: Tiered Compilation

HotSpot has two JIT compilers, C1 (fast to compile, modest code) and C2 (slow to compile, highly optimized code), plus the interpreter. Tiered compilation, on by default since Java 8, moves each method through five *levels*:

| Level | Who             | What it does                                  |
| ----- | --------------- | --------------------------------------------- |
| 0     | Interpreter     | Runs bytecode, collects basic counters        |
| 1     | C1              | Full C1 optimization, no profiling (trivial methods) |
| 2     | C1              | Limited profiling (used when C2 is busy)      |
| 3     | C1              | Full profiling: types, branches, call sites   |
| 4     | C2              | Aggressive, speculative optimization          |

The common path for a hot method is **0 → 3 → 4**:

```text
┌────────────────────────────┐                      ┌──────────────┐
│ Level 0: interpreter       │╌ trivial method ╌╌╌╌▶│ Level 1: C1, │
└────────────────────────────┘                      │ no profiling │
  ▲       │                   ┆                     └──────────────┘
  │       │                   ┆ C2 queue is long
  │       │                   ▼
  │       │     ┌──────────────────────────────┐
  │       │     │ Level 2: C1, light profiling │
  │       │     └──────────────────────────────┘
  │       │ warm: ~hundreds   ┆
  │       │ of calls          ┆
  │       ▼                   ▼
  │   ┌─────────────────────────────────┐
  │   │ Level 3: C1 + full profiling    │
  │   └─────────────────────────────────┘
  │       │ hot: ~thousands
  │       │ of calls
  │       ▼
  │   ┌─────────────────────────────────┐
  │   │ Level 4: C2 optimized           │
  │   └─────────────────────────────────┘
  │                 │ deoptimization
  └─────────────────┘
```

The thresholds are driven by invocation and loop back-edge counters (for example `Tier3InvocationThreshold=200` and `Tier4InvocationThreshold=5000` on JDK 25, combined with other counters and the length of the compile queues). You rarely need to touch them. The key idea: **C2 compiles using the profile gathered at level 3**, so everything in this chapter depends on the profile being representative.

```bash
# Watch methods move through the tiers (one column shows the level)
java -XX:+PrintCompilation -jar myapp.jar
```

## Method Inlining: The King of Optimizations

Inlining replaces a method call with the method's body at the call site. It sounds simple, but it's the **single most impactful optimization** because it enables all other optimizations.

### Why Inlining Matters

```scala
def square(x: Int): Int = x * x
def sumOfSquares(a: Int, b: Int): Int = square(a) + square(b)
```

Without inlining:

```text
sumOfSquares:
  push a
  call square    <- method call overhead
  push b
  call square    <- method call overhead
  add
  return
```

After inlining:

```text
sumOfSquares:
  a * a + b * b   <- no calls, just arithmetic
```

The method call overhead is removed, but more importantly, the JIT can now see the entire computation and optimize further: constant folding, strength reduction, escape analysis, register allocation across the whole thing.

### Inlining Decisions

C2 uses heuristics to decide what to inline:

| Factor         | Effect                                                                  |
| -------------- | ----------------------------------------------------------------------- |
| Method size    | Methods under 35 bytecodes are inlined even if not hot                  |
| Call frequency | Hot call sites may inline methods up to 325 bytecodes                   |
| Already compiled size | A callee whose compiled code is already big (> 2500 bytes of native code) is not inlined |
| Call depth     | Inlining stops at a nesting depth of 15                                 |
| Receiver type  | Monomorphic calls (one observed type) are easiest to inline             |

```bash
# See inlining decisions (a diagnostic flag, so it must be unlocked)
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining -jar myapp.jar

# The defaults (JDK 25, x64) — tuning these is rarely a good idea
-XX:MaxInlineSize=35       # bytecode size for "always" inlining
-XX:FreqInlineSize=325     # bytecode size limit for hot call sites
-XX:InlineSmallCode=2500   # don't inline callees whose native code is larger
-XX:MaxInlineLevel=15      # max inlining depth (was 9 before JDK 14)
```

> [!TIP]
> Keep hot methods small. A 400-bytecode method is too big to be inlined into its callers, even if it's called a billion times. Splitting out the rarely-taken branch (error handling, logging) into its own method often lets the hot part get inlined.

### Inlining and Virtual Calls

Virtual and interface calls (`invokevirtual`, `invokeinterface`) pose a challenge: the JIT doesn't know statically which implementation will run. First it checks the **class hierarchy**: if only one loaded class implements the method, it can inline it outright (and register a dependency, see [Deoptimization](#speculative-optimization-and-deoptimization) below). Otherwise it uses the **type profile** collected at level 3:

- **Monomorphic**: one receiver type seen → inline it behind a cheap type guard
- **Bimorphic**: two types seen → inline both, each behind a type check
- **Megamorphic**: three or more types → no inlining; fall back to a vtable/itable dispatch. The exception: if one type dominates (≥ 90% of calls, `TypeProfileMajorReceiverPercent`), C2 still inlines that one and uses a virtual call for the rest.

```text
// Monomorphic: JIT inlines Dog.speak() directly
animal.speak()  // 100% of calls are Dog  -> inline Dog.speak()

// Bimorphic: JIT inlines both
animal.speak()  // 80% Dog, 20% Cat       -> inline both, with type checks

// Megamorphic: JIT can't inline
animal.speak()  // Dog, Cat, Bird, Fish... -> vtable/itable dispatch
```

> **Scala impact**: Scala's traits and rich class hierarchies can create megamorphic call sites. Generic higher-order methods are the classic case: the single `f.apply(x)` call inside `List.map` sees *every lambda in your program*, so it is megamorphic unless `map` itself gets inlined into your code (where the call site sees just your one lambda). Pattern matching on a sealed type compiles to `instanceof` checks, which the JIT handles well for a handful of cases, so it can be a good alternative to a megamorphic virtual call.

## Escape Analysis

Escape analysis determines whether an object "escapes" the method or thread where it was created. Objects that don't escape can be optimized aggressively.

### Scalar Replacement

If an object doesn't escape, C2 can replace it with its individual fields, kept in registers:

```scala
def distance(x1: Int, y1: Int, x2: Int, y2: Int): Double =
  val p1 = Point(x1, y1)  // Does this Point escape? No!
  val p2 = Point(x2, y2)  // Does this Point escape? No!
  val dx = p2.x - p1.x
  val dy = p2.y - p1.y
  math.sqrt(dx * dx + dy * dy)
```

After escape analysis and scalar replacement:

```scala
// Effectively compiled to:
def distance(x1: Int, y1: Int, x2: Int, y2: Int): Double =
  val dx = x2 - x1    // No Point objects at all!
  val dy = y2 - y1
  math.sqrt(dx * dx + dy * dy)
```

**No heap allocation, no GC pressure, no object headers.** The Point objects are eliminated entirely.

### Lock Elision

The same analysis removes locking on objects that never escape the thread: a `StringBuffer` or a `synchronized` block on a purely local object costs nothing after C2 has seen that nobody else can ever lock it.

> [!NOTE]
> You will often read that the JVM does "stack allocation". **HotSpot doesn't.** C2 either scalar-replaces an object completely or allocates it on the heap as usual (usually cheaply, in the thread's TLAB). The Graal compiler goes one step further with *partial* escape analysis, which we'll meet in [Chapter 20](20-graalvm.md#the-graal-jit-compiler-and-truffle).

### When Escape Analysis Fails

Objects escape when they:
- Are assigned to a field of another object, or to a static field
- Are returned from the method
- Are passed to a method that the JIT doesn't inline
- Are stored in a collection
- Flow into a merge point where C2 can no longer tell which object it is (for example `val p = if (c) Point(1, 2) else Point(3, 4)`)

```scala
// This Point ESCAPES: stored in a list
val points = List(Point(1, 2), Point(3, 4))

// This Point DOESN'T escape: used locally
val p = Point(1, 2)
val sum = p.x + p.y
```

> **Scala gotcha**: Collection pipelines defeat escape analysis, because every intermediate element is stored in an intermediate collection:
> ```scala
> list.map(_.toPoint).filter(_.x > 0)
> // The Points created by map are stored in the intermediate List,
> // so they escape no matter what gets inlined.
> ```

The flags that print escape-analysis decisions (`PrintEscapeAnalysis`, `PrintEliminateAllocations`) only exist in debug builds of the JVM. In practice, measure the effect instead: JMH's `-prof gc` shows allocated bytes per operation, and an allocation profile (JFR or async-profiler, see [Chapter 21](21-monitoring.md)) shows which allocations survived.

## Loop Optimizations

### Loop Unrolling

Instead of jumping back to the loop start on every iteration, the JIT copies the loop body multiple times:

```text
// Before unrolling:
for i in 0..100:
    body(i)

// After unrolling (factor 4):
for i in 0..100 step 4:
    body(i)
    body(i+1)
    body(i+2)
    body(i+3)
```

Fewer branch instructions, better instruction-level parallelism, and a starting point for **auto-vectorization** (C2's "superword" pass turns simple unrolled loops over arrays into SIMD instructions).

### Loop-Invariant Code Motion

Move computations that don't change across iterations outside the loop:

```java
// Before:
for (int i = 0; i < list.size(); i++) {  // list.size() called every iteration!
    process(list.get(i));
}

// After JIT optimization (if size() is inlined and provably unchanged):
int size = list.size();  // Hoisted out of loop
for (int i = 0; i < size; i++) {
    process(list.get(i));
}
```

### Range Check Elimination

Array accesses normally include a bounds check:

```java
array[i]  →  if (i < 0 || i >= array.length) throw new ArrayIndexOutOfBoundsException();
             return array[i];
```

If the JIT can prove that `i` is always in bounds (e.g., from a `for (int i = 0; i < array.length; i++)` loop), it removes the check entirely.

## Constants the JIT Can Trust

Constant folding only works on values the JIT *knows* can't change. `static final` fields qualify: once the class is initialized, their value is baked into compiled code. Plain instance `final` fields mostly don't, because deep reflection (`Field.setAccessible(true)` + `set`) can still change them. HotSpot only trusts instance finals in a few places: records, hidden classes (which back lambdas), and some JDK internals marked with the internal `@Stable` annotation.

That is one motivation behind [JEP 500](https://openjdk.org/jeps/500) <span class="since">Java 26</span>, which warns when deep reflection mutates a `final` field, on the way to "final means final" (see [Chapter 22](22-performance-pitfalls.md#integrity-by-default-new-warnings)). It's also why the **Lazy Constants** API exists (<span class="preview">Preview in 27</span>, [JEP 531](https://openjdk.org/jeps/531)): a `LazyConstant` is computed at most once, and because it's `@Stable` inside, the JIT can fold its value like a `static final` once it's set:

```java
class OrderController {
    // Computed on first use, then treated as a constant by the JIT
    private static final LazyConstant<Logger> LOGGER
        = LazyConstant.of(() -> Logger.create(OrderController.class));

    void submitOrder(User user, List<Product> products) {
        LOGGER.get().info("order started");
    }
}
```

You get the startup benefit of lazy initialization *and* the steady-state speed of an eager constant. (Being a preview API in 27, it needs `--enable-preview`.)

## Speculative Optimization and Deoptimization

The JIT makes bets based on profiling data. When a bet fails, it has a fallback:

```text
JIT observes: process() always receives Dog
JIT compiles:
  if (animal.getClass() == Dog.class) {
      // FAST PATH: inlined Dog code
  } else {
      // UNCOMMON TRAP: deoptimize and go back to the interpreter
  }
```

If a Cat shows up for the first time, the uncommon trap fires:

```text
┌────────────────────────────────┐
│ C2 code running                │
│ (assumes: only Dog)            │
└────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────┐
│ Cat arrives                    │
└────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────┐
│ Uncommon trap fires            │
└────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────┐
│ Compiled code is marked        │
│ 'not entrant'                  │
└────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────┐
│ Current frame is rebuilt as an │
│ interpreter frame, execution   │
│ continues                      │
└────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────┐
│ Profile now includes Cat       │
└────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────┐
│ Method is recompiled           │
│ (Dog and Cat both handled)     │
└────────────────────────────────┘
```

Other bets work the same way: a branch that was never taken (`unstable_if`), a value that was never null, or a class hierarchy fact ("`Animal` has only one subclass"). The last kind is invalidated by **class loading**: loading a second subclass deoptimizes every method that inlined based on the old hierarchy.

This is expensive but rare. The first Cat is slow; subsequent Cats are fast. A method that keeps bouncing between deoptimization and recompilation is a performance bug worth hunting; JFR can tell you about it:

```bash
jfr view deoptimizations-by-reason recording.jfr
jfr view deoptimizations-by-site   recording.jfr
```

## AOT Profiles and AOT Code: Warming Up the JIT in Advance

Everything above happens *at runtime*, which is why a JVM app is slower during its first seconds or minutes: that's warmup. Project Leyden (covered in detail in [Chapter 20](20-graalvm.md)) attacks warmup by recording a **training run** into an *AOT cache*, and two of its features plug straight into the JIT:

- **AOT method profiling** <span class="since">Java 25</span> ([JEP 515](https://openjdk.org/jeps/515)): the level-3 profiles gathered during training are stored in the cache. In production, C2 can compile hot methods right away from those profiles instead of waiting for fresh ones. Production profiling still continues, so the JIT can refine its choices if production behaves differently. The JEP's small Stream example goes from 90 ms to 73 ms (19%).
- **AOT code compilation** (proposed for Java 28, [JEP 544](https://openjdk.org/jeps/544)): the cache also stores native code compiled by C1 and C2 during training. Production loads it instantly, with no compilation at all for those methods.

```text
┌─ Training run ─────────────────────┐
│                                    │
│  ┌──────────────────────────────┐  │
│  │ Interpreter + C1             │  │
│  │ collect profiles             │  │
│  └──────────────────────────────┘  │
│                 │                  │
│                 ▼                  │
│  ┌──────────────────────────────┐  │
│  │ C1/C2 compile hot methods    │  │
│  └──────────────────────────────┘  │
└─────────────────┼──────────────────┘
                  │
                  ▼
   ┌──────────────────────────────┐
   │ AOT cache                    │
   │ classes, profiles, code      │
   └──────────────────────────────┘
                  │
                  │
┌─ Production run ┼──────────────────┐
│                 ▼                  │
│  ┌──────────────────────────────┐  │
│  │ Load cached code             │  │
│  │ (no warmup)                  │  │
│  └──────────────────────────────┘  │
│                 │                  │
│                 ▼                  │
│  ┌──────────────────────────────┐  │
│  │ Keep profiling               │  │
│  └──────────────────────────────┘  │
│                 │                  │
│                 ▼                  │
│  ┌──────────────────────────────┐  │
│  │ Deoptimize / recompile       │  │
│  │ if behaviour differs         │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

The important point: AOT code is not a different kind of code. It's produced by the same C1 and C2, so it's fully interoperable with JIT code and follows the same rules. It can be deoptimized when a speculation fails, and newly hot methods are compiled by the JIT as usual. That's the big difference with GraalVM Native Image, whose compiled code is final: there is no JIT at runtime to fall back on.

## Intrinsics

The JIT recognizes certain well-known methods and replaces them with **hand-optimized machine code** (sometimes a single CPU instruction):

| Method                             | Intrinsic behavior                    |
| ---------------------------------- | ------------------------------------- |
| `Math.min()`, `Math.max()`         | CPU min/max or conditional moves      |
| `System.arraycopy()`               | Optimized memory copy (SIMD)          |
| `String.equals()`, `Arrays.equals()` | Vectorized comparison               |
| `Integer.bitCount()`               | `POPCNT` CPU instruction              |
| `Math.fma()`                       | Fused multiply-add instruction        |
| `Object.hashCode()` (identity)     | Fast path reads the hash from the header |

The JIT doesn't compile these methods from bytecode: it substitutes known-optimal implementations. This is also why "optimizing" JDK code by rewriting it by hand is usually a loss.

## Compiler Control (Advanced)

You can instruct the JIT about specific methods:

```bash
# Force a method to never be compiled (useful for debugging)
-XX:CompileCommand=exclude,com.example.MyClass::myMethod

# Force inlining of a method
-XX:CompileCommand=inline,com.example.MyClass::myMethod

# Print assembly for a specific method (needs the hsdis disassembler library)
-XX:CompileCommand=print,com.example.MyClass::myMethod

# Or use a file:
-XX:CompileCommandFile=hotspot_compiler
```

On a running JVM, `jcmd <pid> Compiler.codecache` and `jcmd <pid> Compiler.queue` show what's been compiled and what's waiting.

> **Scala parallel**: Scala's own inlining happens in the **Scala compiler**, not in the JIT; the JVM never sees these annotations.
> - In Scala 2, `@inline` / `@noinline` are hints for the Scala 2 optimizer, which only runs if you enable it (`-opt:inline:...`).
> - In Scala 3, the `inline` *keyword* guarantees compile-time inlining (and powers metaprogramming):
>
> ```scala
> inline def fastPath(x: Int): Int = x * 2   // always inlined by scalac
> ```
>
> For ordinary methods, trust the JIT: it inlines based on what actually runs.

<div class="takeaways">

## Key Takeaways

- **Tiered compilation** moves hot methods from the interpreter to C1 (with profiling) to C2; C2's quality depends on that profile
- **Method inlining** is the most important optimization: it enables everything else. Small methods (< 35 bytecodes) inline freely; hot ones up to 325 bytecodes
- **Monomorphic** and **bimorphic** call sites inline easily; **megamorphic** (3+ types) sites generally don't
- **Escape analysis** removes allocations via **scalar replacement** and removes uncontended locks; HotSpot does not stack-allocate
- **Loop optimizations**: unrolling, vectorization, invariant code motion, range check elimination
- The JIT trusts `static final` values; instance `final` fields are trusted only in special cases, which is why JEP 500 and **`LazyConstant`** matter
- **Speculative optimization** bets on the profile; **deoptimization** recovers when a bet fails (including when a new class is loaded)
- **Leyden** stores profiles (Java 25) and, soon, compiled code (proposed for 28) in the AOT cache, so the JIT starts warm but can still adapt
- **Intrinsics** replace well-known methods with hand-tuned machine code

</div>
