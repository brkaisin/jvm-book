# Chapter 12 — How the JVM Sees Types

## Two Worlds of Types

Scala's type system and the JVM's type system are radically different. Scala has higher-kinded types, union types, intersection types, match types, path-dependent types, and more. The JVM has... primitives and objects.

Understanding this gap is essential for every Scala developer.

```text
At compile time (scalac / javac)                     At runtime (JVM)
┌──────────────────────┐                            ┌──────────┐
│ List[String]         │── erasure ────────────────▶│ List     │
│                      │                            ├──────────┤
│ Int | String         │── union erased ───────────▶│ Object   │
│                      │                            ├──────────┤
│ F[_]                 │── higher-kinded erased ───▶│ Object   │
│                      │                            ├──────────┤
│ opaque type Meters   │── opaque erased ──────────▶│ double   │
└──────────────────────┘                            └──────────┘
```

## Primitives vs. Reference Types

At the JVM level, there are exactly **two categories of types**.

### Primitive Types (8 of them)

| JVM Primitive | Scala     | Java      | Size     |
| ------------- | --------- | --------- | -------- |
| `boolean`     | `Boolean` | `boolean` | 1 byte\* |
| `byte`        | `Byte`    | `byte`    | 1 byte   |
| `char`        | `Char`    | `char`    | 2 bytes  |
| `short`       | `Short`   | `short`   | 2 bytes  |
| `int`         | `Int`     | `int`     | 4 bytes  |
| `long`        | `Long`    | `long`    | 8 bytes  |
| `float`       | `Float`   | `float`   | 4 bytes  |
| `double`      | `Double`  | `double`  | 8 bytes  |

\* The JVM specification doesn't fix the size of a `boolean`. HotSpot uses one byte for `boolean` fields and `boolean[]` elements; on the operand stack and in local variables, booleans are just `int`s.

Primitives are **not objects**. They have no header, no methods, no identity. They live directly in local variables and on the operand stack, or inline in an object's fields. An `Int` in Scala is a JVM `int` — 4 raw bytes.

### Reference Types (everything else)

Every object, every array, and `null`. A reference is 4 bytes (with compressed oops, the default for heaps under ~32 GB) or 8 bytes. The objects they point to have an object header, methods, and identity (see [Chapter 8](../part-3-memory-and-gc/08-object-layout.md)).

> **Scala's illusion**: In Scala, `Int` looks like an object — you can call methods on it (`42.toString`, `3.max(4)`). This is a compiler trick. Arithmetic like `a + b` becomes a single JVM instruction (`iadd`), and method calls such as `.max` are rewritten into calls on helper objects (like `RichInt`) that the JIT inlines away. Only when an `Int` really has to be treated as an object does `scalac` box it.

> [!NOTE]
> "Every reference type has identity" is about to stop being true. With Project Valhalla's **value objects** (previewing in JDK 28), some objects are still reference types but have *no* identity. [Chapter 14](14-value-types-valhalla.md) tells that story.

## Boxing and Unboxing

The trouble starts when a primitive needs to be treated as an object. The JVM can't put a primitive `int` into a `List` (which stores object references). So the `int` gets **boxed** into a `java.lang.Integer` object:

```scala
val x: Int = 42                  // JVM: int (primitive, 4 bytes)
val y: Any = 1996                // JVM: Integer (boxed object, 16 bytes + a reference)
val list: List[Int] = List(1, 2) // JVM: a List of Integer — every element is boxed
```

**Unboxing** is the reverse: extracting the primitive from the wrapper.

```java
// Java — automatic boxing/unboxing
int a = 5;
Integer b = a;     // Boxing:   int → Integer  (compiles to Integer.valueOf(a))
int c = b;         // Unboxing: Integer → int  (compiles to b.intValue())
```

`Integer.valueOf` keeps a cache of the values −128 to 127, so boxing small numbers doesn't allocate. Everything else gets a fresh object.

**Why this matters**: Boxing creates objects on the heap. In hot loops, this means:

- More GC pressure
- More memory (a 16-byte `Integer` plus a 4-byte reference, versus 4 bytes for an `int`)
- Cache misses (heap objects scattered in memory, versus a contiguous array)

```scala
// Slow: List[Int] holds boxed Integers in linked cons cells
val sum1 = (1 to 1_000_000).toList.sum

// Fast: Array[Int] is a real JVM int[] — no boxing
val sum2 = (1 to 1_000_000).toArray.sum
```

> [!TIP]
> The JIT's escape analysis can sometimes remove a box that never leaves a method, but it can't help once boxes are stored in a collection. If a profiler shows lots of `Integer`/`Long` allocations, look for generic code on a hot path.

## Type Erasure: Generics Vanish at Runtime

This is the most important thing to understand about JVM types: **generic type arguments don't exist in running code**.

When you write `List[String]` in Scala or `List<String>` in Java, the compiler checks your types at compile time. In the bytecode *instructions*, it's just `List`, and the element type is `Object`. The type argument `String` is **erased**.

```scala
val strings: List[String] = List("hello", "world")
val ints: List[Int] = List(1, 2, 3)

// At runtime, the JVM can't tell them apart
strings.getClass == ints.getClass  // true — both are scala.collection.immutable.::
```

### Why Erasure?

When Java 5 added generics in 2004, there were billions of lines of existing Java code using raw types (`List` without `<String>`). Sun chose **migration compatibility**: generics were a compile-time feature, the bytecode instruction set stayed unchanged, and old and new code could call each other without recompilation.

The trade-off: the running code knows nothing about type arguments.

### Erased, but not forgotten

Erasure is less total than people often think. The compiler still writes the generic signatures into the class file, in a `Signature` attribute on classes, fields, and methods. The JVM ignores it when executing, but reflection and tools can read it:

```java
record Inventory(List<String> items) {}

var type = Inventory.class.getRecordComponents()[0].getGenericType();
IO.println(type);   // java.util.List<java.lang.String>
```

What's erased is the type of a *value*: a particular list object doesn't know it was created as a `List<String>`. What's kept is the *declared* type of a field, parameter, or method.

You can see the attribute with `javap -v`, or read it programmatically with the **Class-File API** (`java.lang.classfile`, final since Java 24), which replaced the need for ASM in many JDK-internal tools:

```java
import java.lang.classfile.*;
import java.nio.file.*;

void main() throws Exception {
    ClassModel cm = ClassFile.of().parse(Path.of("Inventory.class"));
    for (MethodModel m : cm.methods()) {
        m.findAttribute(Attributes.signature()).ifPresent(sig ->
            IO.println(m.methodName().stringValue() + " : " + sig.signature().stringValue()));
    }
}
// <init> : (Ljava/util/List<Ljava/lang/String;>;)V
// items : ()Ljava/util/List<Ljava/lang/String;>;
```

(That's a compact source file with an instance `main` method — final since Java 25. Run it with `java Dump.java`.)

### Consequences of Erasure

**1. You can't pattern match on type arguments:**

```scala
def check(x: Any): String = x match
  case _: List[String] => "list of strings"   // Warning! Erased type
  case _: List[Int]    => "list of ints"      // Same as above at runtime!
  case _               => "other"

check(List(1, 2, 3))  // Returns "list of strings"!!! Both cases only test "is it a List?"
```

The compiler warns you — Scala 3 says the type test for `List[String]` "cannot be checked at runtime because its type arguments can't be determined from Any" (Scala 2 calls it an "unchecked" type pattern).

**2. You can't create a generic array:**

```java
// Java — doesn't compile
T[] array = new T[10];  // Error: generic array creation
// After erasure, the JVM doesn't know which array class to allocate
```

**3. `instanceof` can't check type arguments:**

```java
Object obj = List.of("a");
if (obj instanceof List<String> l) { ... }   // Error: Object can't be safely checked as List<String>
if (obj instanceof List<?> l) { ... }        // OK: only checks "is it a List?"
```

Since Java 16, `instanceof List<String>` *is* allowed when the compiler can prove it's safe from the static type — for example when the operand is a `Collection<String>`. In that case the runtime check is still just "is it a `List`?".

### Scala's Workarounds for Erasure

Scala provides several mechanisms to fight erasure.

#### `ClassTag` — Runtime class information

```scala
import scala.reflect.ClassTag

def createArray[T: ClassTag](size: Int): Array[T] =
  new Array[T](size)  // Works! ClassTag carries the runtime class

val arr = createArray[Int](10)  // Creates a real int[], not Object[]
```

`ClassTag` is passed as a context parameter and carries the erased runtime class from the call site. It only knows the class (`List`), not full types (`List[String]`).

#### `TypeTag` (Scala 2 only) — Full type information

```scala
import scala.reflect.runtime.universe.*

def typeOf[T: TypeTag]: String =
  implicitly[TypeTag[T]].tpe.toString

typeOf[List[String]]  // "List[String]" — full type info at runtime!
```

`TypeTag` preserves the complete type, including type arguments. However, it's heavy (it depends on Scala 2's runtime reflection) and it doesn't exist in Scala 3.

#### Scala 3: `TypeTest` and `Typeable`

Scala 3 replaced this with a small, explicit abstraction: a `TypeTest[S, T]` is evidence that a value of type `S` can be checked for `T` at runtime. `Typeable[T]` is an alias for `TypeTest[Any, T]`.

```scala
import scala.reflect.TypeTest

def handle[T](x: Any)(using tt: TypeTest[Any, T]): Option[T] =
  x match
    case t: T => Some(t)    // Safe — the TypeTest performs the check
    case _    => None
```

#### `inline` and Compile-Time Operations (Scala 3)

Scala 3's `inline` methods can inspect types at compile time, sidestepping erasure entirely:

```scala
import scala.compiletime.erasedValue

inline def describe[T]: String =
  inline erasedValue[T] match
    case _: Int    => "an integer"
    case _: String => "a string"
    case _         => "something else"

describe[Int]     // Compiled to just: "an integer" — no runtime check
```

## Runtime Type Tests: How Pattern Matching Compiles

Everything that survives erasure — classes, array types, primitives — can be tested at runtime. Both languages turn "what is this thing?" into a small set of bytecode instructions: `instanceof`, `checkcast`, and accessor calls.

### Java has caught up with Scala

For years, pattern matching was a Scala party trick. Java now has most of it:

| Feature                                        | Status                                              |
| ---------------------------------------------- | --------------------------------------------------- |
| Pattern matching for `instanceof`              | Final in Java 16                                    |
| Sealed classes and interfaces                  | Final in Java 17                                    |
| Pattern matching for `switch`, record patterns | Final in Java 21                                    |
| Unnamed variables and patterns (`_`)           | <span class="since">Java 22</span>                  |
| Primitive types in patterns                    | <span class="preview">Preview in 27</span> (5th)    |

```java
sealed interface Shape permits Circle, Square, Rect {}
record Circle(double radius) implements Shape {}
record Square(double side) implements Shape {}
record Rect(double w, double h) implements Shape {}

static double area(Shape s) {
    return switch (s) {                               // exhaustive: no default needed
        case Circle(var r)          -> Math.PI * r * r;
        case Square(var side)       -> side * side;
        case Rect(var w, var h) when w == h -> w * w;
        case Rect(var w, var h)     -> w * h;
    };
}

static boolean isRound(Shape s) {
    return switch (s) {
        case Circle _          -> true;               // unnamed pattern (Java 22)
        case Square _, Rect _  -> false;
    };
}
```

The Scala equivalent is what you'd expect:

```scala
sealed trait Shape
case class Circle(radius: Double)     extends Shape
case class Square(side: Double)       extends Shape
case class Rect(w: Double, h: Double) extends Shape

def area(s: Shape): Double = s match
  case Circle(r)            => math.Pi * r * r
  case Square(side)         => side * side
  case Rect(w, h) if w == h => w * w
  case Rect(w, h)           => w * h
```

Under the hood, the two compilers take different routes:

- **scalac** compiles a `match` into a chain of `instanceof` checks and casts, then calls the case class accessors (or `unapply` for custom extractors).
- **javac** compiles a pattern `switch` into an `invokedynamic` call to `java.lang.runtime.SwitchBootstraps.typeSwitch`, which returns the index of the first matching case; a plain `tableswitch` then jumps to it. Record patterns call the record's accessor methods. The bootstrap is free to choose a clever strategy at link time (more on `invokedynamic` in [Chapter 13](13-inheritance-and-dispatch.md#invokedynamic-dispatch-you-program-yourself)).

Either way, what gets tested is only what survives erasure: `case Box<String> b` is no more checkable in Java than `case b: Box[String]` is in Scala.

### Primitive types in patterns <span class="preview">Preview in 27</span>

The one big gap left in Java is primitives. JEP 532 (fifth preview, JDK 27; first previewed in JDK 23) allows primitive type patterns everywhere, and lets `switch` work on `boolean`, `long`, `float`, and `double`. For primitives, `instanceof` becomes a **safe conversion test**: it matches only if the value converts without losing information.

```java
int i = 1000;
if (i instanceof byte b) { ... }       // false: 1000 doesn't fit in a byte

long big = 42L;
if (big instanceof int n) { ... }      // true: n == 42

String status(int code) {
    return switch (code) {
        case 0 -> "okay";
        case 1 -> "warning";
        case int n when n >= 500 -> "server error " + n;
        case int n -> "unknown status " + n;   // replaces default, and binds the value
    };
}
```

Compile and run with `--enable-preview --release 27` to try it. Scala has always allowed literal and typed patterns on primitives (`case n: Int if n > 0`), since its pattern matcher works on its own unified `Int` type.

## Arrays: The JVM's Only Covariant "Generic"

Arrays are special. They're the only generic-looking type in the JVM that is:

1. **Reified** — the element type exists at runtime (`int[]` is a different class from `String[]`)
2. **Covariant** — `String[]` is a subtype of `Object[]` in Java

This covariance is **unsound** and leads to runtime errors:

```java
// Java
String[] strings = {"hello", "world"};
Object[] objects = strings;    // Compiles! Array covariance
objects[0] = 42;               // Compiles! Object[] accepts Integer
// Runtime: ArrayStoreException! The actual array is a String[]
```

The JVM checks the actual array type on every reference store — the **array store check**. The JIT eliminates it when it can prove the types, but it exists solely because of this early design decision.

> **Scala's fix**: In Scala, `Array[String]` is NOT a subtype of `Array[Any]`. Arrays are invariant in Scala. The compiler prevents this class of bugs entirely.

```scala
val strings: Array[String] = Array("hello", "world")
val objects: Array[Any] = strings  // Compile error! Arrays are invariant in Scala
```

## Specialization: Fighting Erasure at the JVM Level

The JVM's erasure problem is especially painful for primitives in generic code. Consider:

```scala
def sum[T](list: List[T])(using num: Numeric[T]): T = ...
```

When `T` is `Int`, every element is boxed as `Integer` because `List` stores `Object` references.

### Scala 2's `@specialized`

```scala
def identity[@specialized T](x: T): T = x
```

The Scala 2 compiler generates specialized variants for each primitive type:

```text
identity(int)    → specialized version, no boxing
identity(long)   → specialized version, no boxing
identity(double) → specialized version, no boxing
...
identity(Object) → generic version (for reference types)
```

The downside: up to ten variants per type parameter (nine primitive types including `Unit`, plus the generic one), and the count explodes combinatorially with several type parameters. Scala 3 doesn't implement `@specialized` for user code, so treat it as a Scala 2 tool.

### Scala 3's `opaque type`

A lighter approach. Opaque types exist only at compile time and are erased to their underlying type — no wrapper class is ever generated:

```scala
object Meters:
  opaque type Meters = Double

  def apply(value: Double): Meters = value
  extension (m: Meters)
    def value: Double = m
    def +(other: Meters): Meters = m + other

import Meters.*

val distance: Meters = Meters(3.14)  // At runtime, this is just a double. No object.
```

But an opaque type is only as unboxed as its underlying type: a `List[Meters]` is a `List` of boxed `java.lang.Double`s, exactly like a `List[Double]`.

The JVM-level fix — generics that can hold primitives and value objects without boxing — is Project Valhalla's long-term goal, covered in [Chapter 14](14-value-types-valhalla.md).

## How Scala Types Map to JVM Types

Here's a reference for how Scala's type system compiles down:

| Scala type               | JVM type                                     | Notes                                               |
| ------------------------ | -------------------------------------------- | --------------------------------------------------- |
| `Int`, `Long`, etc.      | `int`, `long`, etc.                          | Primitive where possible                            |
| `Int` in generic context | `java.lang.Integer`                          | Boxed                                               |
| `String`                 | `java.lang.String`                           | Identical                                           |
| `Unit`                   | `void` (or `BoxedUnit`)                      | Return type = void; value = `BoxedUnit.UNIT`        |
| `Nothing`                | `scala.runtime.Nothing$` in signatures       | No value ever exists; such methods throw            |
| `Null`                   | `scala.runtime.Null$` in signatures          | The only value is `null`                            |
| `Any`, `AnyRef`          | `java.lang.Object`                           | Top types → Object                                  |
| `A \| B`, `A & B`        | Erased to a common supertype                 | Often just `Object`                                 |
| `AnyVal` subclass        | Erased to underlying type (when possible)    | Boxed in generic contexts                           |
| `opaque type T = U`      | `U`                                          | No wrapper class at all                             |
| `List[String]`           | `List` (erased)                              | Generic signature kept as metadata only             |
| `trait Foo`              | `interface Foo`                              | With default methods (Scala 2.12+)                  |
| `object Bar`             | `Bar$` class + `Bar` with static forwarders  | Singleton in `Bar$.MODULE$`                         |
| `case class`             | Regular class + companion object class       | Lots of generated methods                           |
| `enum` (Scala 3)         | Sealed abstract class + case objects/classes | Similar to a Java enum for simple cases             |

<div class="takeaways">

## Key Takeaways

- The JVM has only **8 primitive types** and **reference types** — that's it
- **Boxing** wraps primitives in objects; it's automatic but costly (a 16-byte object plus a reference, versus 4 bytes for an `Int`)
- **Type erasure** removes type arguments from running code — `List[String]` and `List[Int]` are the same class — but generic *signatures* survive as class-file metadata, readable via reflection or the Class-File API
- You can't pattern match on erased type arguments — the compiler warns you
- Scala provides **`ClassTag`**, **`TypeTest`**, and **`inline`** to work around erasure
- Java now has **switch patterns and record patterns** (21) and **unnamed patterns** (22); **primitive patterns** are still in preview (5th preview in 27)
- Arrays are **reified** and **covariant in Java** (unsound — `ArrayStoreException`); Scala makes them **invariant**
- **`opaque type`** (Scala 3) costs nothing on its own, but it boxes in generic contexts exactly like its underlying type

</div>
