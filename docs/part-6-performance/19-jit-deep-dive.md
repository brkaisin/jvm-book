# Chapter 19 — JIT Compilation Deep Dive

[← Part VI](index.md) · [Next: GraalVM →](20-graalvm.md)

---

## The JIT's Playbook

We introduced the JIT in [Chapter 7](../part-2-jvm-architecture/07-execution-engine.md). Now let's go deeper into the specific optimizations it performs. These are what make the JVM competitive with (and sometimes faster than) statically compiled languages.

## Method Inlining: The King of Optimizations

Inlining replaces a method call with the method's body at the call site. It sounds simple, but it's the **single most impactful optimization** because it enables all other optimizations.

### Why Inlining Matters

```scala
def square(x: Int): Int = x * x
def sumOfSquares(a: Int, b: Int): Int = square(a) + square(b)
```

Without inlining:
```
sumOfSquares:
  push a
  call square    ← method call overhead
  push b
  call square    ← method call overhead
  add
  return
```

After inlining:
```
sumOfSquares:
  a * a + b * b   ← no calls, just arithmetic
```

The method call overhead is removed, but more importantly, the JIT can now see the entire computation and optimize further — constant folding, strength reduction, register allocation across the whole thing.

### Inlining Decisions

The JIT uses heuristics to decide what to inline:

| Factor         | Effect                                                       |
| -------------- | ------------------------------------------------------------ |
| Method size    | Small methods (< 35 bytecodes by default) are always inlined |
| Call frequency | Hot call sites get priority                                  |
| Call depth     | Inlining stops after a certain depth                         |
| Receiver type  | Monomorphic calls (one implementation) are easiest to inline |

```bash
# See inlining decisions
java -XX:+PrintInlining -jar myapp.jar

# Tune inlining thresholds (rarely needed)
-XX:MaxInlineSize=35       # Max bytecodes for always-inline
-XX:FreqInlineSize=325     # Max bytecodes for hot-inline
-XX:MaxInlineLevel=9       # Max inlining depth
```

### Inlining and Virtual Calls

Virtual methods (`invokevirtual`) pose a challenge: the JIT doesn't know which implementation to inline. It uses **profiling data**:

- **Monomorphic**: Always the same type → inline directly (with a type guard)
- **Bimorphic**: Two types observed → inline both with type checks
- **Megamorphic**: Three or more types → give up inlining, use vtable dispatch

```
// Monomorphic — JIT inlines Dog.speak() directly
animal.speak()  // 100% of calls are Dog → inline Dog.speak()

// Bimorphic — JIT inlines both
animal.speak()  // 80% Dog, 20% Cat → inline both with type checks

// Megamorphic — JIT can't inline
animal.speak()  // Dog, Cat, Bird, Fish... → vtable dispatch (slow)
```

> **Scala impact**: Scala's traits and rich class hierarchies can create megamorphic call sites. If you have a `List[Animal]` with many different subclasses, and you call `.speak()` on each one, the JIT can't inline. This is one reason why pattern matching with sealed types can be faster — the compiler generates `instanceof` checks that the JIT handles well.

## Escape Analysis

Escape analysis determines whether an object "escapes" the method or thread where it was created. Objects that don't escape can be optimized aggressively.

### Scalar Replacement

If an object doesn't escape, the JIT can replace it with its individual fields:

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

### Stack Allocation

If scalar replacement isn't possible but the object still doesn't escape the method, it can be allocated on the stack instead of the heap:

- Stack allocation is essentially free (just bump a pointer)
- No GC needed (reclaimed when the method returns)
- Better cache locality (stack is always hot in cache)

### When Escape Analysis Fails

Objects escape when they:
- Are assigned to a field of another object
- Are returned from the method
- Are passed to a method that the JIT can't inline
- Are stored in a collection

```scala
// This Point ESCAPES — stored in a list
val points = List(Point(1, 2), Point(3, 4))

// This Point DOESN'T escape — used locally
val p = Point(1, 2)
val sum = p.x + p.y
```

> **Scala gotcha**: Method chaining can prevent escape analysis if intermediate objects escape to methods the JIT can't see:
> ```scala
> list.map(_.toPoint).filter(_.x > 0)
> // The Points created by map are passed to filter
> // If filter isn't inlined, the Points "escape" and must be heap-allocated
> ```

```bash
# See escape analysis results
java -XX:+PrintEscapeAnalysis -XX:+PrintEliminateAllocations -jar myapp.jar
```

## Loop Optimizations

### Loop Unrolling

Instead of jumping back to the loop start on every iteration, the JIT copies the loop body multiple times:

```
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

Fewer branch instructions, better instruction-level parallelism.

### Loop-Invariant Code Motion

Move computations that don't change across iterations outside the loop:

```java
// Before:
for (int i = 0; i < list.size(); i++) {  // list.size() called every iteration!
    process(list.get(i));
}

// After JIT optimization:
int size = list.size();  // Hoisted out of loop
for (int i = 0; i < size; i++) {
    process(list.get(i));
}
```

### Range Check Elimination

Array accesses normally include a bounds check:

```java
array[i]  →  if (i < 0 || i >= array.length) throw ArrayIndexOutOfBoundsException;
              return array[i];
```

If the JIT can prove that `i` is always in bounds (e.g., from a `for (int i = 0; i < array.length; i++)` loop), it removes the check entirely.

## Speculative Optimization and Uncommon Traps

The JIT makes bets based on profiling data. When a bet fails, it has a fallback:

```
JIT observes: process() always receives Dog
JIT compiles:
  if (animal instanceof Dog) {
      // FAST PATH: inlined Dog code
  } else {
      // UNCOMMON TRAP: deoptimize and go back to interpreter
  }
```

If a Cat shows up for the first time, the uncommon trap fires:
1. The native code is **discarded**
2. Execution returns to the **interpreter**
3. New profiling data is collected (now including Cat)
4. The method is **recompiled** with updated assumptions

This is expensive but rare. The first Cat is slow; subsequent Cats are fast (the recompiled code handles both).

## Intrinsics

The JIT recognizes certain well-known methods and replaces them with **hand-optimized native code** (or single CPU instructions):

| Method                     | Intrinsic behavior            |
| -------------------------- | ----------------------------- |
| `Math.min()`, `Math.max()` | CPU min/max instructions      |
| `System.arraycopy()`       | Optimized memory copy (SIMD)  |
| `String.equals()`          | Vectorized comparison         |
| `Integer.bitCount()`       | `POPCNT` CPU instruction      |
| `Arrays.sort()`            | Optimized sort implementation |
| `Object.hashCode()`        | Fast hash computation         |

The JIT doesn't compile these methods from bytecode — it substitutes known-optimal implementations.

## Compiler Control (Advanced)

You can instruct the JIT about specific methods:

```bash
# Force a method to never be compiled (useful for debugging)
-XX:CompileCommand=exclude,com.example.MyClass::myMethod

# Force inlining of a method
-XX:CompileCommand=inline,com.example.MyClass::myMethod

# Print assembly for a specific method
-XX:CompileCommand=print,com.example.MyClass::myMethod

# Or use a file:
-XX:CompileCommandFile=hotspot_compiler
```

In Scala, you can use `@inline` and `@noinline` annotations as hints:

```scala
@inline def fastPath(x: Int): Int = x * 2      // Hint: please inline this
@noinline def slowPath(x: Int): Int = compute(x) // Hint: don't inline this
```

But these are *suggestions* — the JIT makes the final decision.

## Key Takeaways

- **Method inlining** is the most important optimization — it enables everything else
- **Monomorphic** call sites inline easily; **megamorphic** (3+ types) sites can't be inlined
- **Escape analysis** eliminates heap allocations via scalar replacement or stack allocation
- **Loop optimizations**: unrolling, invariant code motion, range check elimination
- **Speculative optimization** bets on common cases; **uncommon traps** handle exceptions
- **Intrinsics** replace well-known methods with hand-tuned native code
- Scala's functional patterns (lambdas, case classes, chaining) interact well with inlining and escape analysis — after warmup, they're often zero-cost

---

[← Part VI](index.md) · [Next: GraalVM →](20-graalvm.md)
