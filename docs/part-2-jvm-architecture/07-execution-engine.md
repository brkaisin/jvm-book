# Chapter 7 — The Execution Engine

[← Previous: Runtime Data Areas](06-runtime-data-areas.md) · [Next: Part III — Memory & GC →](../part-3-memory-and-gc/README.md)

---

## From Bytecode to Speed

The execution engine is the heart of the JVM. It takes bytecode and turns it into something the CPU can actually run. But it doesn't do it in one way — it uses a clever combination of techniques that give you the best of both worlds: fast startup *and* peak performance.

## The Interpreter

When the JVM first encounters a method, it **interprets** it — reads each bytecode instruction, looks up what it means, and executes the corresponding operation.

```
Bytecode instruction:  iadd
Interpreter action:    1. Pop two ints from operand stack
                       2. Add them
                       3. Push the result
                       Next instruction...
```

This is simple, requires no setup time, and starts immediately. But it's slow — each instruction goes through a decode-dispatch cycle, and there's no chance to optimize across instructions.

Think of it like a tourist reading a recipe one word at a time from a phrasebook, translating each word individually. It works, but it's not fast.

## The JIT Compiler (Just-In-Time)

The JIT compiler is the magic that makes the JVM fast. When it detects that a method is "hot" — called frequently — it compiles the entire method to **native machine code**. After that, the JVM runs the native code directly, bypassing the interpreter entirely.

```
Method call #1–#9,999:     Interpreted (slow but instant)
Method call #10,000:       JIT compiles to native code (brief pause)
Method call #10,001+:      Runs native machine code (C-like speed)
```

The key insight: **the JIT compiler knows more than a static compiler**. A C compiler sees your code once, at compile time. The JIT sees it *running*. It knows:

- Which branches are taken and which aren't
- What types actually flow through polymorphic call sites
- Which objects escape a method and which don't
- How often loops execute

It uses this information to make aggressive optimizations that a static compiler can't.

## Tiered Compilation

Modern HotSpot uses **tiered compilation** — a system with multiple compilation levels:

```
Level 0: Interpreter
           │
           ▼
Level 1: C1 with full optimization    (simple methods)
Level 2: C1 with invocation counters  (gather more data)
Level 3: C1 with full profiling       (most methods start here)
           │
           ▼
Level 4: C2 with aggressive optimization (hot methods)
```

There are two JIT compilers inside HotSpot:

### C1 (Client Compiler)
- Compiles quickly
- Produces moderately optimized code
- Also gathers **profiling data** while the code runs (what types are seen, which branches are taken)
- Good for startup speed

### C2 (Server Compiler)
- Compiles slowly (more optimization passes)
- Produces highly optimized code
- Uses the profiling data gathered by C1
- Good for peak throughput

The typical flow for a method:

1. **Interpreted** for the first few invocations
2. Compiled by **C1** with profiling (Level 3)
3. If the method stays hot, recompiled by **C2** (Level 4) using the profiling data

This is why JVM applications have a **warmup period**. During the first seconds or minutes, the JIT is compiling hot paths. After warmup, the application reaches peak performance.

> **See it in action**: Run your application with `-XX:+PrintCompilation` to see what the JIT is compiling:
>
> ```bash
> java -XX:+PrintCompilation -jar myapp.jar
> ```
>
> Output:
> ```
>    87    1       3       java.lang.String::hashCode (55 bytes)
>   105    2       3       java.lang.String::charAt (33 bytes)
>   198    3       4       java.lang.String::hashCode (55 bytes)
> ```
>
> The third column is the tier (3 = C1, 4 = C2). Notice `hashCode` is compiled by C1 first, then recompiled by C2 later.

## Key JIT Optimizations

Let's look at the most impactful optimizations the JIT performs.

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

- **No escape**: The object is only used within the method → Can be **allocated on the stack** (or even dissolved into local variables) instead of the heap. No GC needed!
- **Arg escape**: The object is passed to another method but doesn't escape beyond that → Partial optimization possible
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

This is called **scalar replacement** — the object is broken into its individual fields (scalars).

> **Scala case classes benefit enormously**: When you create a `case class` instance for a quick computation and it doesn't escape the method, the JIT can eliminate the allocation entirely. This is one reason why Scala's pattern of creating many small immutable objects isn't as expensive as you'd think.

### Loop Optimizations

- **Loop unrolling**: Replace a loop with repeated code to reduce branch overhead
- **Loop-invariant code motion**: Move computations that don't change across iterations outside the loop
- **Range check elimination**: If the JIT can prove array indices are always in bounds, it removes the bounds checks

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

If the JIT observes that `animal.speak()` is *always* called on a `Dog`, it speculates:

```java
void process(Animal animal) {
    if (animal instanceof Dog) {  // Cheapest possible check
        // Inlined Dog.speak() code here
    } else {
        // Uncommon trap — deoptimize if this ever happens
        animal.speak();  // Slow path
    }
}
```

This is called **guarded inlining** or **type profiling**. The JIT bets on the common case and prepares a fallback for the rare case.

## Deoptimization

What happens when the JIT's assumptions break? **Deoptimization**.

If the JIT compiled `process()` assuming all animals are `Dog`s, and suddenly a `Cat` shows up, the JVM:

1. Detects the broken assumption (the "uncommon trap" fires)
2. **Throws away** the optimized native code
3. Returns to **interpreting** the method
4. Recompiles later with updated profiling data (this time knowing about both `Dog` and `Cat`)

This sounds expensive, but it's rare. And the result is better: the JIT now generates code that handles both types efficiently.

> **Practical impact**: If you see strange performance drops after your application has been running for a while, deoptimization might be the cause. A new code path that triggers an uncommon trap can cause a hot method to be recompiled.

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

The JVM literally swaps out the stack frame, remapping local variables from the interpreter's format to the compiled code's format. It's a remarkable piece of engineering.

## AOT Compilation: GraalVM Native Image

The JIT model has a downside: **startup time**. For the first few seconds (or minutes under heavy load), your application runs slowly as the JIT warms up. This is fine for long-running servers but painful for:

- Command-line tools
- Serverless functions (AWS Lambda)
- Microservices that scale to zero

**Ahead-of-Time (AOT) compilation** is the alternative. GraalVM's `native-image` compiles your entire application to a native executable before it runs:

```bash
# Compile a Scala app to a native binary
native-image -jar myapp.jar -o myapp

# Run it — instant startup!
./myapp   # Starts in milliseconds, not seconds
```

### Trade-offs

| Aspect               | JIT (HotSpot)                         | AOT (Native Image)                          |
| -------------------- | ------------------------------------- | ------------------------------------------- |
| **Startup time**     | Slow (seconds)                        | Fast (milliseconds)                         |
| **Peak throughput**  | Excellent (after warmup)              | Good (but no profiling-guided optimization) |
| **Memory footprint** | Higher (JIT compiler, profiling data) | Lower                                       |
| **Compatibility**    | Full (reflection, dynamic loading)    | Limited (closed-world assumption)           |
| **Build time**       | Fast (`javac`/`scalac`)               | Slow (whole-program analysis)               |

The **closed-world assumption** is the key limitation: Native Image must see all reachable code at build time. No dynamic class loading, no runtime bytecode generation, and reflection requires explicit configuration. This breaks some libraries and frameworks.

> **Scala and Native Image**: Frameworks like http4s, ZIO, and Scala CLI have good native image support. But if you use heavy reflection-based libraries (some Scala macro libraries, certain serialization frameworks), you'll need to provide reflection configuration.

## The Graal JIT Compiler

GraalVM also includes a **JIT compiler written in Java** (replacing C2). The Graal JIT:

- Is more modular and easier to extend than C2 (which is written in C++)
- Supports **partial escape analysis** — a more powerful version of escape analysis
- Can perform better optimizations in some cases, especially for Scala's functional patterns
- Is the foundation for GraalVM's polyglot capabilities (Truffle framework)

You can use the Graal JIT without Native Image by adding a flag:

```bash
java -XX:+UseJVMCICompiler -jar myapp.jar
```

## Warmup: What It Means in Practice

For a typical Scala web service:

```
Time 0s      → Start. Everything interpreted. Slow.
Time 1-5s    → C1 compiling hot methods. Getting faster.
Time 5-30s   → C2 recompiling the hottest paths. Near peak performance.
Time 30s-2m  → Aggressive optimizations kicking in. Peak performance.
```

This is why:
- **Don't benchmark cold code**. Run your benchmark for thousands of iterations before measuring.
- **Load balancers should warm up new instances** before sending full traffic.
- **sbt's `jmh` plugin** (Java Microbenchmark Harness) handles warmup automatically.

```scala
// JMH benchmark in Scala
import org.openjdk.jmh.annotations.*

@State(Scope.Benchmark)
@Warmup(iterations = 5, time = 1)     // 5 warmup iterations
@Measurement(iterations = 10, time = 1) // 10 measured iterations
class MyBenchmark:
  @Benchmark
  def testMethod(): Int =
    (1 to 1000).sum
```

## Key Takeaways

- The JVM uses **two execution modes**: interpreter (fast startup) and JIT compiler (peak performance)
- **Tiered compilation**: C1 compiles first (with profiling), C2 recompiles hot methods (with aggressive optimization)
- **Method inlining** is the most important optimization — it enables everything else
- **Escape analysis** can eliminate object allocations entirely
- The JIT makes **speculative optimizations** based on runtime behavior and deoptimizes if assumptions break
- **On-Stack Replacement** can optimize a method while it's running
- **GraalVM Native Image** trades JIT warmup for instant startup (with compatibility trade-offs)
- JVM applications need **warmup time** — don't benchmark cold code

---

[← Previous: Runtime Data Areas](06-runtime-data-areas.md) · [Next: Part III — Memory & GC →](../part-3-memory-and-gc/README.md)
