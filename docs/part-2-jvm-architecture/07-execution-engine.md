# Chapter 7 — The Execution Engine

## From Bytecode to Speed

The execution engine is the heart of the JVM. It takes bytecode and turns it into something the CPU can actually run. But it doesn't do it in one way — it uses a clever combination of techniques that give you the best of both worlds: fast startup *and* peak performance. And since Java 24, it can also reuse work from a previous run of your application.

## The Interpreter

When the JVM first encounters a method, it **interprets** it — reads each bytecode instruction, looks up what it means, and executes the corresponding operation.

```text
Bytecode instruction:  iadd
Interpreter action:    1. Pop two ints from operand stack
                       2. Add them
                       3. Push the result
                       Next instruction...
```

This is simple, requires no setup time, and starts immediately. But it's slow — each instruction goes through a decode-dispatch cycle, and there's no chance to optimize across instructions. (HotSpot's "template interpreter" is already cleverer than a big `switch` statement: at startup it generates a small piece of machine code for each bytecode. It's still an interpreter, though.)

Think of it like a tourist reading a recipe one word at a time from a phrasebook, translating each word individually. It works, but it's not fast.

While interpreting, the JVM also **counts**: how often each method is called and how often each loop iterates. Those counters decide what gets compiled.

## The JIT Compiler (Just-In-Time)

The JIT compiler is the magic that makes the JVM fast. When it detects that a method is "hot" — called frequently, or containing a loop that runs a lot — it compiles the method to **native machine code**, stored in the [code cache](06-runtime-data-areas.md#the-code-cache--where-compiled-code-lives). After that, calls to the method jump straight into the native code, bypassing the interpreter.

```text
First calls:             Interpreted (slow but instant)
A few hundred calls:     Compiled by C1, a quick compiler (in the background)
Thousands of calls:      Recompiled by C2, an optimizing compiler
From then on:            Runs highly optimized machine code
```

Compilation happens on **background compiler threads**, so your code doesn't stop and wait: it keeps running in the interpreter until the compiled version is ready.

The key insight: **the JIT compiler knows more than a static compiler**. A C compiler sees your code once, at compile time. The JIT sees it *running*. It knows:

- Which branches are taken and which aren't
- What types actually flow through polymorphic call sites
- Which objects escape a method and which don't
- How often loops execute

It uses this information to make aggressive optimizations that a static compiler can't.

## Tiered Compilation

HotSpot contains **two JIT compilers**, and uses them together in a scheme called **tiered compilation** (the default since Java 8):

### C1 (Client Compiler)
- Compiles quickly
- Produces moderately optimized code
- Can insert **profiling** code that records what happens at run time (what types are seen, which branches are taken)
- Good for startup speed

### C2 (Server Compiler)
- Compiles slowly (more optimization passes)
- Produces highly optimized code
- Uses the profiling data gathered earlier to speculate aggressively
- Good for peak throughput

The "tiers" are the possible states of a method:

| Tier | Who                 | Typical use                                        |
| ---- | ------------------- | -------------------------------------------------- |
| 0    | Interpreter         | Every method starts here                           |
| 1    | C1, no profiling    | Trivial methods (getters) that C2 can't improve on |
| 2    | C1, light profiling | Stand-in when C2 is too busy                       |
| 3    | C1, full profiling  | The usual step for warm methods                    |
| 4    | C2, fully optimized | Hot methods                                        |

The typical path is **0 → 3 → 4**: interpreted at first, compiled by C1 with profiling once it's warm (by default, around 200 invocations), then recompiled by C2 once it's really hot (thousands of invocations), using the profile collected in tier 3. Figure 7.1 shows this pipeline, and where the AOT cache plugs into it.

<figure class="fig">
{{#include ../figures/07-tiered-aot.svg}}
<figcaption><b>Figure 7.1.</b> A method climbs from the interpreter to C1 and then C2, falls back to the interpreter when a speculation fails, and the AOT cache lets it skip steps.</figcaption>
</figure>

The solid arrows are the classic JIT pipeline (trivial methods take a side exit to tier 1, not shown). The dashed arrows coming down from the cache are the shortcuts that Project Leyden's AOT cache adds, which we'll look at [below](#the-aot-cache-project-leyden).

This pipeline explains why JVM applications have a **warmup period**. During the first seconds or minutes, the JIT is compiling hot paths. After warmup, the application reaches peak performance.

> [!TIP]
> **See it in action**: Run your application with `-XX:+PrintCompilation` to see what the JIT is compiling:
>
> ```bash
> java -XX:+PrintCompilation -jar myapp.jar
> ```
>
> Output (abridged):
>
> ```text
>  17    3   3  java.lang.String::hashCode (60 bytes)
>  20   10   3  java.lang.String::charAt (25 bytes)
> 198  412   4  java.lang.String::hashCode (60 bytes)
> 199    3   3  java.lang.String::hashCode (60 bytes)  made not entrant
> ```
>
> The columns are: milliseconds since startup, compilation ID, tier, method. Notice `hashCode` is compiled by C1 (tier 3) first, then by C2 (tier 4) later, after which the old C1 version is **made not entrant**: no new calls will enter it.

## Key JIT Optimizations

Let's look at the most impactful optimizations the JIT performs. ([Chapter 19](../part-6-performance/19-jit-deep-dive.md) goes deeper.)

### Method Inlining

**The single most important optimization.** Instead of making a method call (which has overhead: set up a new frame, jump, return), the JIT copies the method's code directly into the caller.

```java
// Before inlining:
public int calculate(int x) {
    return square(x) + 1;
}
private int square(int x) {
    return x * x;
}

// After inlining (conceptually):
public int calculate(int x) {
    return (x * x) + 1;  // No method call overhead!
}
```

Inlining is critical because it **enables other optimizations**. Once the code is inlined, the JIT can see the full picture and optimize across what were previously separate methods.

> **Scala impact**: Scala's functional style creates chains of method calls: `list.map(f).filter(g).flatMap(h)`. Each of those is a method call with a lambda. The JIT inlines these aggressively, and after inlining, the lambda allocations can often be eliminated too. This is why Scala's "expensive-looking" functional code can be surprisingly fast after warmup.

### Escape Analysis

The JIT analyzes whether an object "escapes" the method where it was created:

- **No escape**: The object is only used within the method (after inlining) → it doesn't need to exist as a heap object at all
- **Arg escape**: The object is passed to other methods but never stored anywhere → some optimizations still apply, such as removing locks on it
- **Global escape**: The object is stored in a field, returned, or otherwise reachable from outside → Must be allocated on the heap normally

```java
public int sumPoints() {
    Point p = new Point(3, 4);  // JIT: this Point never escapes!
    return p.x + p.y;
}

// After escape analysis + scalar replacement:
public int sumPoints() {
    int p_x = 3;  // Point object eliminated entirely!
    int p_y = 4;
    return p_x + p_y;  // Just local variables, no allocation
}
```

This is called **scalar replacement** — the object is broken into its individual fields (scalars), which then live in CPU registers or the stack frame. HotSpot doesn't do "stack allocation" of whole objects; scalar replacement is its (better) alternative.

> **Scala case classes benefit enormously**: When you create a `case class` instance for a quick computation and it doesn't escape the method, the JIT can eliminate the allocation entirely. This is one reason why Scala's pattern of creating many small immutable objects isn't as expensive as you'd think. (Valhalla's value classes, previewing in Java 28, will make this far more reliable — see [Chapter 14](../part-4-type-system/14-value-types-valhalla.md).)

### Loop Optimizations

- **Loop unrolling**: Replace a loop with repeated code to reduce branch overhead
- **Loop-invariant code motion**: Move computations that don't change across iterations outside the loop
- **Range check elimination**: If the JIT can prove array indices are always in bounds, it removes the bounds checks
- **Auto-vectorization**: Use SIMD instructions to process several array elements per instruction

### Dead Code Elimination

If the JIT can prove that code has no effect (e.g., a result that's never used), it removes it entirely. This is why micro-benchmarks are tricky — the JIT might optimize away the very thing you're trying to measure!

```java
// The JIT might eliminate this entirely if the result is unused:
for (int i = 0; i < 1_000_000; i++) {
    Math.sqrt(i);  // Result discarded → dead code
}
```

### Speculative Optimization

This is where the JIT gets really clever. It makes optimizations based on *assumptions* about your code's behavior:

```java
void process(Animal animal) {
    animal.speak();  // Virtual call — could be Dog, Cat, Bird...
}
```

If the profile shows that `animal.speak()` is *always* called on a `Dog`, C2 speculates:

```java
void process(Animal animal) {
    if (animal.getClass() == Dog.class) {  // Cheap check: compare class pointers
        // Inlined Dog.speak() code here
    } else {
        uncommonTrap();  // "This never happened before": deoptimize
    }
}
```

This is called **guarded inlining**, driven by **type profiling**. The JIT bets on the common case and prepares a way out for the rare case.

## Deoptimization

What happens when the JIT's assumptions break? **Deoptimization**.

If C2 compiled `process()` assuming all animals are `Dog`s, and suddenly a `Cat` shows up, the JVM:

1. Detects the broken assumption (the "uncommon trap" fires)
2. Rebuilds the interpreter's view of the current frame (locals, operand stack) from the optimized code's state
3. Continues running the method in the **interpreter**, and marks the compiled code as not entrant
4. Recompiles later with updated profiling data (this time knowing about both `Dog` and `Cat`)

Deoptimization can also be triggered by class loading: if C2 assumed that `Animal` had only one implementation, loading a new subclass invalidates that code.

This sounds expensive, but it's rare. And the result is better: the JIT now generates code that handles both types efficiently.

> [!NOTE]
> **Practical impact**: If you see strange performance drops after your application has been running for a while, deoptimization might be the cause. A new code path that triggers an uncommon trap can cause a hot method to fall back to the interpreter until it is recompiled. Look for `made not entrant` lines in `-XX:+PrintCompilation` output, or use JFR's deoptimization events.

## On-Stack Replacement (OSR)

What if a hot loop is in a method that's already running? The JIT can't wait for the method to be called again — it needs to optimize *now*.

**On-Stack Replacement** replaces the currently running interpreted code with compiled code, *mid-execution*:

```java
void processAll(List<Item> items) {
    for (Item item : items) {   // This loop runs 10 million times
        // After some iterations, JIT compiles the loop body
        // and switches to native code WITHOUT restarting the method
        process(item);
    }
}
```

The JVM literally swaps out the stack frame, remapping local variables from the interpreter's format to the compiled code's format. It's a remarkable piece of engineering. (In `PrintCompilation` output, OSR compilations are marked with `%`.)

## Warmup: What It Means in Practice

For a typical Scala web service, a cold start looks roughly like this:

```text
Time 0s      → Start. Classes load, everything interpreted. Slow.
Time 1-5s    → C1 compiling warm methods. Getting faster.
Time 5-30s   → C2 recompiling the hottest paths. Near peak performance.
Time 30s-2m  → Remaining hot paths optimized. Peak performance.
```

(The exact numbers depend entirely on your application and traffic.) This is why:
- **Don't benchmark cold code**. Run your benchmark for thousands of iterations before measuring.
- **Load balancers should warm up new instances** before sending full traffic.
- **JMH** (Java Microbenchmark Harness, via the `sbt-jmh` plugin in Scala) handles warmup automatically.

```scala
// JMH benchmark in Scala
import org.openjdk.jmh.annotations.*

@State(Scope.Benchmark)
@Warmup(iterations = 5, time = 1)       // 5 warmup iterations
@Measurement(iterations = 10, time = 1) // 10 measured iterations
class MyBenchmark:
  @Benchmark
  def testMethod(): Int =
    (1 to 1000).sum
```

For a long-running server, warmup is a small tax paid once. For command-line tools, serverless functions, and services that scale up and down all day, it's a real cost. There are two ways to reduce it: start from a snapshot of a previous run (the AOT cache), or compile everything ahead of time (GraalVM Native Image).

## The AOT Cache (Project Leyden)

**Project Leyden** is OpenJDK's effort to improve startup time, warmup time, and footprint *without* giving up the dynamic Java platform. Its central tool is the **AOT cache** <span class="since">Java 24</span>: you run your application once in a **training run**, the JVM records what it did, and later **production runs** start from that recorded state.

```bash
# Training run (Java 25+): run a representative workload, cache written on exit
java -XX:AOTCacheOutput=app.aot -cp app.jar com.example.App

# Production runs
java -XX:AOTCache=app.aot -cp app.jar com.example.App
```

The cache has grown with each release:

| Release | JEP | What the cache adds                                                          |
| ------- | --- | ---------------------------------------------------------------------------- |
| 24      | 483 | Classes already **loaded and linked** (see [Chapter 4](04-class-loaders.md)) |
| 25      | 514 | One-step creation with `-XX:AOTCacheOutput`                                  |
| 25      | 515 | **Method profiles**: C2 can compile hot methods right away                   |
| 26      | 516 | Cached Java objects work with **any GC**, including ZGC                      |
| 28      | 544 | **Compiled native code** from C1 and C2 (proposed to target)                 |

Method profiles (JEP 515) attack warmup directly. Normally, C2 has to wait until tier 3 has collected enough profile data. With profiles from the training run in the cache, the JIT knows from the start which methods are hot and which types flow where, so it can produce optimized code much earlier. Profiling continues in production, so the JIT still adapts if the real workload differs from the training run.

AOT code compilation (JEP 544, proposed for Java 28) goes one step further: the native code that C1 and C2 produced during training is stored in the cache and loaded instantly at startup. It's the same compilers, so AOT code and JIT code mix freely, and the JIT can still recompile if production behaves differently. The JEP reports startup improvements of 65–80% across its framework benchmarks, compared with 50–70% for the AOT cache without code. The catch: training and production must use the same CPU architecture and features (e.g., AVX-512) and the same garbage collector; otherwise the JVM falls back to JIT compilation.

> [!IMPORTANT]
> The AOT cache is an *optimization*, never a change in behavior: if the cache is missing, stale, or doesn't match (different JDK, classpath, or GC), the JVM simply runs without it. Use `-XX:AOTMode=required` (JDK 27; `-XX:AOTMode=on` on JDK 24–26) during testing if you want it to fail loudly instead. And make your training run realistic: the cache can only contain what the training run actually exercised.

> **Scala connection**: The AOT cache works with any JVM language, since it operates on classes and bytecode. An sbt-assembled fat JAR or a classpath of JARs is all it needs, with no reflection configuration and no framework support required.

## Full AOT Compilation: GraalVM Native Image

The other approach is to give up on the JIT entirely. GraalVM's `native-image` tool compiles your whole application, plus the parts of the JDK it uses, into a standalone native executable before it runs:

```bash
# Compile a Scala app to a native binary
native-image -jar myapp.jar -o myapp

# Run it — instant startup!
./myapp   # Starts in milliseconds, not seconds
```

The **closed-world assumption** is the key limitation: Native Image must see all reachable code at build time. No loading of unknown classes at run time, no runtime bytecode generation, and reflection requires explicit configuration. This breaks some libraries and frameworks, though frameworks like Quarkus, Micronaut, and Spring Boot have invested heavily in supporting it.

### Trade-offs

| Aspect            | JIT (+ AOT cache)                      | Native Image                                 |
| ----------------- | -------------------------------------- | -------------------------------------------- |
| **Startup**       | Seconds; much less with the AOT cache  | Milliseconds                                 |
| **Warmup**        | Needed; shortened by cached profiles   | None (but peak is fixed at build time)       |
| **Peak speed**    | Excellent, adapts to the live workload | Good; better with profile-guided builds      |
| **Memory**        | Higher (JIT, profiles, metadata)       | Lower                                        |
| **Compatibility** | Full Java: reflection, dynamic loading | Closed world; reflection needs configuration |
| **Build**         | Normal build + a training run          | Slow whole-program compilation               |

> [!NOTE]
> **Where GraalVM stands in 2026**: In September 2025 Oracle announced that it was detaching GraalVM from the Java SE release train. Oracle GraalVM for JDK 24 was the last release shipped as part of Oracle's Java SE products, and the GraalVM team refocused on the Graal languages (GraalPy, GraalJS). Native Image itself is not discontinued — GraalVM 25 releases continue on the quarterly update cadence — but for "make my regular JVM app start and warm up faster", **Project Leyden is now the mainstream OpenJDK path**. Native Image remains the choice when you need the smallest, fastest-starting closed-world binary. [Chapter 20](../part-6-performance/20-graalvm.md) covers it in depth.

> **Scala and Native Image**: Scala CLI can package apps as native images, and libraries such as http4s and ZIO work well with it. Heavy reflection-based libraries (some serialization frameworks, for example) need reflection configuration. Scala Native is a separate, unrelated route: it compiles Scala to native code via LLVM without a JVM at all.

## The Graal JIT Compiler

Besides Native Image, the Graal project produced a **JIT compiler written in Java**, which plugs into HotSpot through the JVM Compiler Interface (JVMCI) and takes the place of C2. It's known for a more powerful form of escape analysis (*partial escape analysis*), which often helps allocation-heavy Scala code.

Be careful with old instructions, though: an experimental copy of Graal shipped inside OpenJDK from Java 10 but was removed in Java 17 (JEP 410). Today, the Graal JIT is the default JIT compiler *in GraalVM distributions*; a standard OpenJDK build uses C1 and C2, and has no Graal compiler to switch to. See [Chapter 20](../part-6-performance/20-graalvm.md) for details.

<div class="takeaways">

## Key Takeaways

- The JVM combines an **interpreter** (instant start) with **JIT compilers** (peak performance), compiling on background threads
- **Tiered compilation**: methods usually go interpreter (tier 0) → C1 with profiling (tier 3) → C2 (tier 4)
- **Method inlining** is the most important optimization — it enables everything else
- **Escape analysis** and scalar replacement can eliminate object allocations entirely
- The JIT makes **speculative optimizations** based on runtime profiles and **deoptimizes** back to the interpreter if assumptions break
- **On-Stack Replacement** can switch a long-running loop to compiled code mid-execution
- JVM applications need **warmup time** — don't benchmark cold code
- The **AOT cache** (Project Leyden, Java 24+) records a training run: loaded and linked classes (24), method profiles (25), and compiled code (proposed for 28), cutting both startup and warmup while keeping full Java compatibility
- **GraalVM Native Image** trades the JIT for instant startup and a small footprint, under a closed-world assumption

</div>
