# Chapter 14 — Value Types and Project Valhalla

[← Previous: Inheritance and Dispatch](13-inheritance-and-dispatch.md) · [Next: Part V — Concurrency →](../part-5-concurrency/index.md)

---

## The Problem: Everything Is a Pointer

We saw in [Chapter 8](../part-3-memory-and-gc/08-object-layout.md) that every object on the JVM has a header (12–16 bytes of overhead) and is accessed through a reference (a pointer). For large objects, this overhead is negligible. But for small value-like things — coordinates, colors, money amounts, timestamps — the overhead dominates.

Consider a `Point` with two `int` fields:

```
Actual data:     8 bytes  (two ints)
Object header:  16 bytes  (mark word + class pointer + padding)
Total:          24 bytes  (3× the actual data!)
```

And when you store these in an array:

```
Array[Point] in JVM:
┌──────────┐    ┌────────┐    ┌────────┐
│ ref[0] ──┼──▶│ Header │    │ Header │
│ ref[1] ──┼───┤ x = 1  │    │ x = 3  │
│ ref[2] ──┼─┐ │ y = 2  │    │ y = 4  │
└──────────┘ │ └────────┘    └────────┘
             │    ┌────────┐
             └──▶│ Header │
                  │ x = 5  │
                  │ y = 6  │
                  └────────┘

What we WANT (like C structs):
┌───────────┬───────────┬───────────┐
│ x=1, y=2  │ x=3, y=4  │ x=5, y=6  │
└───────────┴───────────┴───────────┘
(contiguous, no headers, no indirection)
```

The pointer-based layout has three costs:
1. **Memory waste**: Headers and references eat space
2. **Cache misses**: Objects are scattered on the heap; the CPU cache can't prefetch them
3. **GC overhead**: More objects = more work for the garbage collector

## Today's Workarounds

### Java: Primitive types only

Java's primitives (`int`, `long`, `double`, etc.) avoid these costs — they're stored inline, with no headers. But you can't define your own primitives. And as soon as you use generics, they get boxed.

### Scala: `AnyVal`

```scala
case class UserId(value: Long) extends AnyVal
```

Scala's `AnyVal` tells the compiler: "This is just a wrapper. Erase it at runtime." In many cases, `UserId(42L)` compiles to just the `long` value `42L`, with no object.

But `AnyVal` has limitations:
- Boxing occurs in generic contexts: `List[UserId]` → `List[java.lang.Long]`
- Boxing occurs when the value class is used as a trait type
- Can't have multiple fields
- Can't be stored in an array without boxing

```scala
val id: UserId = UserId(42L)       // No object — just a long
val ids: List[UserId] = List(id)   // Boxed! List stores objects, not primitives
```

### Scala 3: `opaque type`

```scala
object UserId:
  opaque type UserId = Long
  def apply(value: Long): UserId = value
  extension (id: UserId) def value: Long = id
```

Opaque types are erased at compile time — `UserId` IS `Long` at the bytecode level. But unlike `AnyVal`:
- No boxing wrapper class exists at all
- The compiler never generates a `UserId` class
- However, in generic contexts, boxing to `java.lang.Long` still happens (because the JVM has no concept of the opaque type)

Both `AnyVal` and `opaque type` are **compile-time tricks** that the JVM knows nothing about. They can't solve the fundamental problem: the JVM doesn't have user-defined value types.

## Project Valhalla: The Real Fix

**Project Valhalla** is the JVM's initiative to add true **value types** — user-defined types that behave like primitives:

- No object header
- No identity (no reference equality, no synchronization)
- Stored inline (in arrays, in fields of other objects)
- Flattened in memory (contiguous, no pointers)
- No boxing when used in generics (the ultimate goal)

### Value Classes (Proposed)

```java
// Proposed Java syntax (still evolving)
value class Point {
    int x;
    int y;
}
```

A `Point` value would be:
- **Stored inline**: An array of `Point` is a contiguous block of `(x, y)` pairs, no headers
- **Passed by copy**: Like primitives, value types are copied when assigned or passed (no references)
- **No identity**: `==` compares fields, not memory addresses. You can't use `synchronized` on a value type.

```
Array<Point> with Valhalla:
┌────┬────┬────┬────┬────┬────┐
│x=1 │y=2 │x=3 │y=4 │x=5 │y=6│    ← Flat, contiguous, no headers
└────┴────┴────┴────┴────┴────┘

vs. today:
┌──────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ref[0]│→ │header│x=1│y=2│  │header│x=3│y=4│  │header│x=5│y=6│
│ref[1]│→                │                  │
│ref[2]│→                                   │
└──────┘
```

### Universal Generics (No More Erasure!)

The most ambitious part of Valhalla: **generics over primitives and value types** without boxing.

Today:
```java
List<int> numbers;  // ILLEGAL in Java — must use List<Integer>
```

With Valhalla (the goal):
```java
List<int> numbers;    // Legal — stored as raw ints, no boxing
List<Point> points;   // Legal — stored flat, no headers
```

This would eliminate the entire class of boxing-related performance problems. `List[Int]` in Scala could finally mean a list of actual `int` values, not boxed `Integer` objects.

### The Identity Problem

Today, every object has **identity** — you can ask "are these two references the same object in memory?" (`==` in Java, `eq` in Scala). Value types don't have identity:

```java
value class Point { int x; int y; }

Point a = new Point(1, 2);
Point b = new Point(1, 2);
// a and b are equal. But are they the "same" object? The question is meaningless.
// There's no memory address to compare — they might be stored inline, copied, etc.
```

This means:
- No `synchronized(point)` — value types can't be used as locks
- No `System.identityHashCode()` — no identity to hash
- `==` checks **value equality**, not reference equality

This is a fundamental change to the JVM's object model, which is why Valhalla has been in development for over a decade.

## The Current State of Valhalla (2025)

Valhalla is being delivered incrementally:

| Feature                          | Status                     | JEP     |
| -------------------------------- | -------------------------- | ------- |
| Value classes (null-free types)  | Preview / Experimental     | JEP 401 |
| Primitive classes (inline types) | In development             | —       |
| Universal generics               | Research / Early prototype | —       |
| Generic specialization           | Future                     | —       |

As of Java 24, early aspects of Valhalla are available as previews, but the full vision (universal generics, specialized `List<int>`) is still in progress.

### What's Available Now

**Null-restricted types** and **value class** semantics are being previewed. The JVM is getting the ability to mark classes as identity-free, which is the foundation for the rest.

## Benchmarking the Cost of Boxing

Let's make the cost tangible. Here's a simple benchmark: sum 10 million integers.

```java
// Version 1: primitive int array (no boxing)
int[] primitiveArray = new int[10_000_000];
// Fill with values...
long sum = 0;
for (int i = 0; i < primitiveArray.length; i++) {
    sum += primitiveArray[i];
}

// Version 2: Integer array (boxed)
Integer[] boxedArray = new Integer[10_000_000];
// Fill with values...
long sum = 0;
for (int i = 0; i < boxedArray.length; i++) {
    sum += boxedArray[i];  // unboxing on every iteration
}
```

Typical results on modern hardware:

| Version     | Time   | Memory |
| ----------- | ------ | ------ |
| `int[]`     | ~5 ms  | 40 MB  |
| `Integer[]` | ~25 ms | 200 MB |

5× slower, 5× more memory. The difference comes from:
- Object header overhead per element
- Pointer chasing (cache misses)
- Unboxing on every access

In Scala:

```scala
// Fast: Array[Int] → JVM int[]
val arr1 = Array.fill(10_000_000)(42)
arr1.sum  // No boxing

// Slow: List[Int] → linked list of boxed Integer
val list1 = List.fill(10_000_000)(42)
list1.sum  // Boxing, pointer chasing, poor cache locality
```

## What Valhalla Means for Scala

When Valhalla lands fully:

1. **`opaque type` becomes even more powerful**: If the underlying type is a value class, `opaque type` wrappers cost truly nothing — even in generic contexts.

2. **Generic collections of primitives**: `List[Int]` could use specialized storage (no boxing). The Scala collection library might generate specialized versions automatically.

3. **Scala value classes could map to JVM value types**: `case class Point(x: Int, y: Int)` could become a true value type — no header, flat storage.

4. **Effect types benefit**: `IO[Int]` in Cats Effect could store the `Int` inline instead of boxing it.

5. **Less need for specialization workarounds**: No more `@specialized`, no more manual primitive arrays for performance.

However, Scala will need compiler changes to take advantage of these JVM features. The Scala team is tracking Valhalla closely.

## Key Takeaways

- Every JVM object has a **header** (12–16 bytes) and is accessed via a **pointer** — expensive for small values
- **Boxing** wraps primitives in objects, costing 4–5× in memory and speed
- Scala's **`AnyVal`** and **`opaque type`** avoid boxing in many cases, but not in generic contexts
- **Project Valhalla** aims to add true value types: no headers, inline storage, flat arrays
- The ultimate goal: **universal generics** — `List<int>` without boxing
- Value types sacrifice **identity** (no `synchronized`, no `identityHashCode`)
- Valhalla has been in development for 10+ years; features are being delivered incrementally
- When complete, it will be the biggest change to the JVM object model since its inception

---

[← Previous: Inheritance and Dispatch](13-inheritance-and-dispatch.md) · [Next: Part V — Concurrency →](../part-5-concurrency/index.md)
