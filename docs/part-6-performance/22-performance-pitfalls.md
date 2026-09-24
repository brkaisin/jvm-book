# Chapter 22 — Common Performance Pitfalls

## The Traps That Wait for You

Performance pitfalls on the JVM are often invisible at the source level. The code looks clean, but the bytecode or runtime behavior hides expensive operations. Let's catalog the most common ones.

## Autoboxing: The Silent Killer

Every time a primitive is used where an object is expected, a wrapper object is created. This is **autoboxing**. (Small values, `-128` to `127` by default, come from a cache, so they don't allocate; everything else does.)

```java
// Java
List<Integer> numbers = new ArrayList<>();
for (int i = 0; i < 1_000_000; i++) {
    numbers.add(i);  // int → Integer autoboxing, 1 million times!
}
```

```scala
// Scala
val numbers: List[Int] = (0 until 1_000_000).toList
// Each Int is boxed as java.lang.Integer in the List
```

### Where Boxing Hides

| Code Pattern                          | Boxing?                              |
| ------------------------------------- | ------------------------------------ |
| `Array[Int]`                          | No — JVM `int[]`                     |
| `List[Int]`                           | Yes — `List[Integer]`                |
| `Map[String, Int]`                    | Yes — values are `Integer`           |
| `Option[Int]`                         | Yes — `Some(Integer)`                |
| `def f(x: Int): Int`                  | No — primitive parameters and return |
| `def f[T](x: T): T` called with `Int` | Yes — generics erase to `Object`     |
| `val x: Any = 42`                     | Yes — `Any` is `Object`              |

### Detecting Boxing

```bash
# With async-profiler's allocation mode
asprof -d 30 -e alloc -f alloc.html <pid>

# Or with JFR
jfr view allocation-by-class recording.jfr

# Look for java.lang.Integer, java.lang.Long, etc.
```

### Fixing Boxing

```scala
// Instead of List[Int] (boxed):
val arr = Array.fill(1_000_000)(0)   // Array[Int] → int[], no boxing

// Use specialized collections:
// - Java: IntStream, LongStream, int[], Eclipse Collections IntList
// - Scala: Array[Int], or libraries like spire

// Use views to avoid intermediate collections:
val result = data.view.filter(_ > 0).map(_ * 2).sum  // One pass, less boxing
```

> [!NOTE]
> Boxing is also what [Project Valhalla](../part-4-type-system/14-value-types-valhalla.md) is about. With value classes (JEP 401, a preview in JDK 28), `Integer` and friends become value objects without identity, which lets the JVM flatten and scalarize them much more freely. That's future work; for now, boxing costs what it has always cost.

## Megamorphic Call Sites

We covered this in [Chapter 19](19-jit-deep-dive.md#inlining-and-virtual-calls), but it's worth emphasizing as a pitfall. A call site is **megamorphic** when 3+ different types are observed (and none of them dominates):

```scala
trait Processor:
  def process(data: String): String

// If you have many implementations:
val processors: List[Processor] = List(
  JsonProcessor(), XmlProcessor(), CsvProcessor(),
  YamlProcessor(), ProtobufProcessor()  // 5 types!
)

processors.foreach(_.process(data))
// The JIT can't inline process() — megamorphic dispatch via itable
```

### Detecting Megamorphic Sites

```bash
# Inlining decisions: look for "virtual call" or "no static binding" at hot call sites
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining -jar myapp.jar
```

Or look for `itable stub` / `vtable stub` frames in an async-profiler flame graph of the hot path.

### Fixing It

- Reduce the number of types at a call site (restructure code)
- Use pattern matching with sealed types instead of virtual dispatch (for a handful of cases)
- Separate hot paths by type

```scala
// Instead of one polymorphic call site:
sealed trait Shape
case class Circle(r: Double) extends Shape
case class Square(s: Double) extends Shape

// With a few cases, a match (a chain of type checks) can beat a megamorphic call:
def area(shape: Shape): Double = shape match
  case Circle(r) => math.Pi * r * r
  case Square(s) => s * s
```

## String Concatenation

### The Old Way (Before Java 9)

```java
String s = "Hello " + name + "! You are " + age + " years old.";
```

Before Java 9, this compiled to:
```java
new StringBuilder().append("Hello ").append(name).append("! You are ")
    .append(age).append(" years old.").toString();
```

Every concatenation created a `StringBuilder`, allocated a `char[]`, and copied data. In loops, this was terrible.

### The New Way (Java 9+)

Java 9+ compiles string concatenation using `invokedynamic` (JEP 280), and the JVM generates the concatenation code at runtime. It computes the exact buffer size upfront and avoids the intermediate `StringBuilder` copies.

### The Loop Trap (Still Relevant)

```java
// STILL BAD — even with invokedynamic, this creates a new String per iteration
String result = "";
for (String item : items) {
    result += item;  // O(n²) — copies all previous characters every time!
}

// GOOD — explicit StringBuilder
StringBuilder sb = new StringBuilder();
for (String item : items) {
    sb.append(item);
}
String result = sb.toString();
```

In Scala:
```scala
// BAD
items.foldLeft("")(_ + _)  // O(n²)

// GOOD
items.mkString  // Uses StringBuilder internally

// ALSO GOOD for complex cases
val sb = new StringBuilder
items.foreach(sb.append)
sb.toString
```

## Excessive Allocation in Functional Code

Scala's functional style is beautiful but can create lots of intermediate objects:

```scala
// Creates 4 intermediate collections:
val result = data
  .filter(_.isActive)        // New List
  .map(_.transform())        // New List
  .flatMap(_.children)       // New List
  .sortBy(_.priority)        // New List
  .take(10)                  // New List
```

### Fix: Use Views

```scala
// Only ONE collection for the filter/map/flatMap part (sortBy still needs a real one):
val result = data.view
  .filter(_.isActive)
  .map(_.transform())
  .flatMap(_.children)
  .to(List)
  .sortBy(_.priority)  // sortBy needs the full collection
  .take(10)
```

### Fix: Use Iterator

```scala
// Zero intermediate collections (one-pass, lazy):
val result = data.iterator
  .filter(_.isActive)
  .map(_.transform())
  .flatMap(_.children)
  .take(10)  // Short-circuits! Doesn't process the rest
  .toList
```

### Fix: Use Specialized APIs

```scala
// Instead of:
list.filter(predicate).headOption

// Use:
list.find(predicate)  // Stops at first match, no intermediate collection

// Instead of:
list.map(f).sum

// Use:
list.foldLeft(0)((acc, x) => acc + f(x))  // No intermediate collection
```

## `lazy val` Locking Overhead

In Scala 2, `lazy val` uses double-checked locking with `synchronized` (a volatile flag, then a lock on `this` in a separate `lzycompute` method):

```scala
lazy val expensive = computeSomething()
```

Compiles roughly to:
```java
private Object expensive;
private volatile boolean expensive$initialized = false;

public Object expensive() {
    if (!expensive$initialized) {
        synchronized (this) {
            if (!expensive$initialized) {
                expensive = computeSomething();
                expensive$initialized = true;
            }
        }
    }
    return expensive;
}
```

Every access checks the volatile flag. In hot paths, this overhead adds up. (On JDK 24+, the `synchronized` part no longer pins virtual threads: see [below](#virtual-threads-synchronized-no-longer-pins-java-24).)

**Scala 3** uses a different, lock-free scheme (a compare-and-set on the field, with a marker object while initialization is in progress), and Scala 3.3 introduced a reworked implementation. Still, every access reads a volatile field and checks its state, so a `lazy val` is never quite as cheap as an eager `val`.

### When to Worry

- `lazy val` in a trait mixed into many instances, accessed frequently
- `lazy val` in a tight loop

### Fix

- Use eager `val` if the initialization cost is trivial or always needed
- Hoist the value into a local `val` before a hot loop, so the loop doesn't re-check it on every iteration
- For Scala 2, consider `@volatile var` with manual initialization if `lazy val` is a bottleneck

## Implicit Conversions and Allocations

Scala 2's implicit conversions can allocate wrapper objects:

```scala
// Implicit conversion — creates a wrapper object every time
implicit class RichInt(val self: Int) extends AnyVal {
  def isEven: Boolean = self % 2 == 0
}

42.isEven  // Should be zero-cost (AnyVal)... usually
```

`AnyVal` usually avoids allocation, but boxing happens when:
- The extension method is called on a generic type
- The value is used as a trait type
- The value is pattern matched in certain ways

In Scala 3, extension methods are first-class and don't use implicit conversions:

```scala
extension (i: Int)
  def isEven: Boolean = i % 2 == 0

42.isEven  // Compiled to a plain method call — no wrapper object, ever
```

## Collection Pitfalls

### Indexed Access on `List`

```scala
// This is O(n) for each element access: List is a linked list!
val first = myList(0)  // Walks 0 links
val tenth = myList(9)  // Walks 9 links

// Use Vector for indexed access:
val v = myList.toVector
v(9)  // O(log₃₂ n) — effectively O(1)
```

### `List.length` Is O(n)

```scala
// DON'T:
if (list.length > 0) { ... }  // Traverses entire list to count!

// DO:
if (list.nonEmpty) { ... }    // Checks only the head
```

### `Map.mapValues` Returns a View (Scala 2.13+)

```scala
val mapped = myMap.mapValues(_ * 2)   // deprecated in 2.13
// This is a VIEW (a MapView): the function runs again on every access!

// Be explicit, and force it if you'll access values multiple times:
val mapped = myMap.view.mapValues(_ * 2).toMap
// or simply:
val mapped = myMap.map((k, v) => k -> v * 2)
```

## Pitfalls of the Modern JVM

The JVM of 2026 has changed a few assumptions that older articles (and older habits) rely on. None of these are bugs, but each can surprise you after an upgrade.

### Object Size Math Has Changed <span class="since">Java 27</span>

Since JDK 27, **compact object headers** are on by default (JEP 534): an object header is 8 bytes instead of 12, and an array header 12 bytes instead of 16 (see [Chapter 8](../part-3-memory-and-gc/08-object-layout.md)). Any memory estimate that hard-codes "12 bytes of header" is now wrong:

| Object                  | JDK ≤ 26 default | JDK 27 default |
| ----------------------- | ---------------- | -------------- |
| `new Object()`          | 16 bytes         | 8 bytes        |
| `Integer`               | 16 bytes         | 16 bytes       |
| `Long`, `Double`        | 24 bytes         | 16 bytes       |
| `case class P(x: Int, y: Int)` | 24 bytes  | 16 bytes       |

Two practical consequences:
- **Capacity planning and cache sizing** based on per-object estimates should be redone (with JOL, or with a heap histogram) rather than recalculated by hand. Heaps full of small objects typically shrink noticeably (JEP 534 reports 22% less heap on SPECjbb2015).
- **Before/after comparisons across JDK versions** now include this change. If you need the old layout for a fair comparison (or because of a problem), `-XX:-UseCompactObjectHeaders` turns it off.

### G1 Is Now the Default in Small Containers <span class="since">Java 27</span>

Until JDK 26, the JVM picked **Serial GC** on machines it didn't consider "server class": fewer than 2 CPUs or less than 1792 MB of memory. That describes a lot of containers, so many small services silently ran on Serial. Since JDK 27 (JEP 523), **G1 is the default everywhere**.

For most apps this is an improvement (shorter pauses on larger heaps), but it can change footprint and throughput on tiny containers. If you measured and Serial was better for you, say so explicitly:

```bash
java -XX:+UseSerialGC -XX:MaxRAMPercentage=75 -jar myapp.jar
```

> [!TIP]
> Whatever the collector, set heap size relative to the container (`-XX:MaxRAMPercentage`) and check what the JVM actually chose with `jcmd <pid> VM.flags` or `java -Xlog:gc -version`.

### Virtual Threads: `synchronized` No Longer Pins <span class="since">Java 24</span>

On JDK 21–23, blocking inside `synchronized` pinned a virtual thread to its carrier, and the standard advice was to replace `synchronized` with `ReentrantLock`. Since JDK 24 (JEP 491) that's no longer necessary: `synchronized` blocks, `Object.wait()`, and Scala 2's `lazy val` locks all let the virtual thread unmount. Pinning remains only in rare cases involving native code and class initialization ([Chapter 18](../part-5-concurrency/18-virtual-threads.md#pinning-mostly-solved)).

The pitfall now is the opposite one: spending effort on rewrites that no longer help. If you're still on JDK 21 LTS, the old advice applies; either way, check with JFR (`jfr view pinned-threads recording.jfr`) before changing code.

### Integrity by Default: New Warnings

The JDK is steadily closing the doors that let libraries bypass Java's rules. Each step starts with a **warning on standard error** at first use, then a future release turns it into an error:

| Since   | What triggers a warning                                    | Control flag                                 |
| ------- | ---------------------------------------------------------- | -------------------------------------------- |
| JDK 24  | Memory-access methods of `sun.misc.Unsafe` (JEP 498)       | `--sun-misc-unsafe-memory-access=allow\|warn\|debug\|deny` |
| JDK 24  | Loading or calling native code via JNI (JEP 472)           | `--enable-native-access=ALL-UNNAMED`         |
| JDK 26  | Mutating a `final` field with deep reflection (JEP 500)    | `--enable-final-field-mutation=ALL-UNNAMED`  |

These are not performance problems in themselves, but they matter for performance work:

- **Final fields and the JIT.** The JIT can't treat instance `final` fields as constants because reflection might change them ([Chapter 19](19-jit-deep-dive.md#constants-the-jit-can-trust)). JEP 500 is the first step towards "final means final", which will let the JVM optimize them. Libraries that set `final` fields reflectively (some serialization, dependency-injection, and mocking libraries) now print a warning such as `WARNING: Final field f in p.C has been mutated by class ...`; the default will eventually become `deny` (`--illegal-final-field-mutation=allow|warn|debug|deny` controls it today). Serialization libraries are expected to move to `sun.reflect.ReflectionFactory`; records and hidden classes were never mutable this way.
- **Old fast paths going away.** Many high-performance libraries used `sun.misc.Unsafe` for off-heap memory and field access. The supported replacements are `VarHandle` (for field and array access) and the FFM API's `MemorySegment` (for off-heap memory), which the JIT optimizes just as well. Upgrading such libraries is part of any JDK 24+ migration.

> **Scala note**: Code compiled with Scala 3 before 3.8 implements `lazy val` through `scala.runtime.LazyVals`, which uses `sun.misc.Unsafe`. On JDK 24+ this prints a warning like `sun.misc.Unsafe::objectFieldOffset has been called by scala.runtime.LazyVals$` the first time a lazy val is used. Scala 3.8 (and the new 3.9 LTS) generate lazy vals without `Unsafe`, but libraries compiled with older Scala 3 versions can still trigger the warning until they are republished. It's harmless for now; `--sun-misc-unsafe-memory-access=allow` silences it while you upgrade.

## Benchmarking Correctly with JMH

Never benchmark with `System.currentTimeMillis()`:

```scala
// WRONG — unreliable, affected by warmup, dead code elimination, etc.
val start = System.currentTimeMillis()
for (_ <- 0 until 1000000) { compute() }
val elapsed = System.currentTimeMillis() - start
```

Use **JMH (Java Microbenchmark Harness)**:

```scala
import java.util.concurrent.TimeUnit
import org.openjdk.jmh.annotations.*
import org.openjdk.jmh.infra.Blackhole

@State(Scope.Benchmark)
@BenchmarkMode(Array(Mode.AverageTime))
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
@Fork(2)
class MyBenchmark:

  var data: List[Int] = Nil

  @Setup
  def setup(): Unit =
    data = List.range(0, 10_000)

  @Benchmark
  def listMap(bh: Blackhole): Unit =
    bh.consume(data.map(_ + 1))  // Blackhole prevents dead code elimination

  @Benchmark
  def arrayMap(bh: Blackhole): Unit =
    bh.consume(data.toArray.map(_ + 1))
```

JMH handles:
- Warmup (JIT compilation)
- Dead code elimination prevention (`Blackhole`)
- Fork isolation (separate JVM per run)
- Statistical analysis (mean, error, confidence intervals)
- Profilers: `-prof gc` shows allocated bytes per operation, which is often more telling than the time

In sbt, use the **sbt-jmh** plugin (`Jmh/run`). Keep the JDK and flags identical between runs you compare: on JDK 27, compact object headers are on by default, so a benchmark comparing JDK 25 and 27 measures that change too.

## Quick Checklist

| Pitfall                      | Detection                   | Fix                                                 |
| ---------------------------- | --------------------------- | --------------------------------------------------- |
| Autoboxing                   | Allocation profiler         | `Array[Int]`, views, specialized collections        |
| Megamorphic dispatch         | `PrintInlining`, flame graph | Sealed types, pattern matching, less polymorphism  |
| String concat in loops       | Code review                 | `StringBuilder`, `mkString`                         |
| Intermediate collections     | Allocation profiler         | Views, iterators, fold                              |
| `lazy val` in hot path       | CPU profiler                | Eager `val`, hoist into a local                     |
| `List.length` / `List(i)`    | Code review                 | `nonEmpty`, `Vector` for indexed access             |
| Stale object-size estimates  | JOL, heap histogram         | Re-measure on JDK 27 (compact headers)              |
| Unexpected GC in containers  | `jcmd VM.flags`             | Choose the GC and heap size explicitly              |
| Integrity warnings on stderr | Startup logs                | Upgrade libraries; flags only as a stopgap          |
| Wrong benchmark              | Common sense                | Use JMH                                             |

<div class="takeaways">

## Key Takeaways

- **Autoboxing** is the #1 hidden cost for Scala code using generic collections
- **Megamorphic call sites** prevent inlining: keep hot call sites to ≤ 2 types
- Use **views** and **iterators** to avoid intermediate collections
- Scala 3 **extension methods** never allocate a wrapper; Scala 2 `implicit class extends AnyVal` *usually* doesn't
- **`lazy val`** has a per-access cost: don't use it in tight loops
- On **JDK 27**, compact headers change object sizes and **G1** is the default even in small containers: re-measure, don't assume
- Since **JDK 24**, `synchronized` no longer pins virtual threads; don't rewrite code for that reason
- **Integrity warnings** (Unsafe, JNI, final-field mutation) are the JDK asking you to upgrade libraries
- **JMH** is the only reliable way to benchmark JVM code

</div>
