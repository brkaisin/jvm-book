# Chapter 22 — Common Performance Pitfalls

[← Previous: Monitoring](21-monitoring.md) · [Next: Part VII — Ecosystem →](../part-7-ecosystem/README.md)

---

## The Traps That Wait for You

Performance pitfalls on the JVM are often invisible at the source level. The code looks clean, but the bytecode or runtime behavior hides expensive operations. Let's catalog the most common ones.

## Autoboxing: The Silent Killer

Every time a primitive is used where an object is expected, the JVM creates a wrapper object. This is **autoboxing**:

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
./asprof -d 30 -e alloc -f alloc.html <pid>

# Look for java.lang.Integer, java.lang.Long, etc. in the flame graph
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

## Megamorphic Call Sites

We covered this in Chapter 19, but it's worth emphasizing as a pitfall. A call site is **megamorphic** when 3+ different types are observed:

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
java -XX:+PrintCompilation -XX:+TraceTypeProfile -jar myapp.jar
```

Or use JFR/async-profiler and look for vtable/itable lookups in hot paths.

### Fixing It

- Reduce the number of types at a call site (restructure code)
- Use pattern matching with sealed types instead of virtual dispatch
- Separate hot paths by type

```scala
// Instead of one polymorphic call site:
sealed trait Shape
case class Circle(r: Double) extends Shape
case class Square(s: Double) extends Shape

// Pattern matching is often faster than virtual dispatch for sealed types:
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

Java 9+ compiles string concatenation using `invokedynamic`, which the JVM can optimize much more aggressively — potentially avoiding `StringBuilder` entirely and computing the exact buffer size upfront.

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
// Creates only ONE collection:
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

In Scala 2, `lazy val` uses double-checked locking with `synchronized`:

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

Every access checks the volatile flag. In hot paths, this overhead adds up.

**Scala 3** improved this with a more efficient implementation, but `lazy val` still has overhead compared to eager `val`.

### When to Worry

- `lazy val` in a trait mixed into many instances, accessed frequently
- `lazy val` in a tight loop

### Fix

- Use eager `val` if the initialization cost is trivial or always needed
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

42.isEven  // Compiled to a static method call — zero allocation, always
```

## Collection Pitfalls

### `List.apply` vs `::` for Building Lists

```scala
// This is O(n) for each element access — List is a linked list!
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
val mapped = myMap.mapValues(_ * 2)
// This is a VIEW — the function is called every time you access a value!

// Force it if you'll access values multiple times:
val mapped = myMap.view.mapValues(_ * 2).toMap
```

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
import org.openjdk.jmh.annotations.*

@State(Scope.Benchmark)
@BenchmarkMode(Array(Mode.AverageTime))
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
@Fork(2)
class MyBenchmark:

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

## Quick Checklist

| Pitfall                   | Detection               | Fix                                                 |
| ------------------------- | ----------------------- | --------------------------------------------------- |
| Autoboxing                | Allocation profiler     | Use `Array[Int]`, views, specialized collections    |
| Megamorphic dispatch      | `-XX:+PrintCompilation` | Sealed types, pattern matching, reduce polymorphism |
| String concat in loops    | Code review             | `StringBuilder`, `mkString`                         |
| Intermediate collections  | Allocation profiler     | Views, iterators, fold                              |
| `lazy val` in hot path    | CPU profiler            | Eager `val`                                         |
| `List.length` / `List(i)` | Code review             | `nonEmpty`, `Vector` for indexed access             |
| Wrong benchmark           | Common sense            | Use JMH                                             |

## Key Takeaways

- **Autoboxing** is the #1 hidden cost for Scala code using generic collections
- **Megamorphic call sites** prevent inlining — keep hot call sites to ≤2 types
- Use **views** and **iterators** to avoid intermediate collections
- Scala 3 **extension methods** are zero-cost; Scala 2 `implicit class extends AnyVal` is *usually* zero-cost
- **`lazy val`** has locking overhead — don't use it in tight loops
- **JMH** is the only reliable way to benchmark JVM code

---

[← Previous: Monitoring](21-monitoring.md) · [Next: Part VII — Ecosystem →](../part-7-ecosystem/README.md)
