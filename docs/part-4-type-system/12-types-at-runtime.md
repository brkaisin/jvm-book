# Chapter 12 — How the JVM Sees Types

[← Part IV](index.md) · [Next: Inheritance and Dispatch →](13-inheritance-and-dispatch.md)

---

## Two Worlds of Types

Scala's type system and the JVM's type system are radically different. Scala has higher-kinded types, union types, intersection types, match types, path-dependent types, and more. The JVM has... primitives and objects.

Understanding this gap is essential for every Scala developer.

## Primitives vs. Reference Types

At the JVM level, there are exactly **two categories of types**:

### Primitive Types (8 of them)

| JVM Primitive | Scala     | Java      | Size    |
| ------------- | --------- | --------- | ------- |
| `boolean`     | `Boolean` | `boolean` | 1 byte  |
| `byte`        | `Byte`    | `byte`    | 1 byte  |
| `char`        | `Char`    | `char`    | 2 bytes |
| `short`       | `Short`   | `short`   | 2 bytes |
| `int`         | `Int`     | `int`     | 4 bytes |
| `long`        | `Long`    | `long`    | 8 bytes |
| `float`       | `Float`   | `float`   | 4 bytes |
| `double`      | `Double`  | `double`  | 8 bytes |

Primitives are **not objects**. They have no header, no methods, no identity. They live directly on the stack or inline in an object's fields. An `Int` in Scala is a JVM `int` — 4 raw bytes.

### Reference Types (everything else)

Every object, array, and `null`. References are 4 or 8 bytes (pointers to the heap). They have object headers, methods, and identity.

> **Scala's illusion**: In Scala, `Int` looks like an object — you can call methods on it (`42.toString`). But this is a compiler trick. `scalac` compiles `Int` operations as JVM primitive `int` operations. The `.toString` call is compiled to a static method call, not a virtual method on a boxed integer.

## Boxing and Unboxing

The trouble starts when a primitive needs to be treated as an object. The JVM can't put a primitive `int` into a `List` (which stores object references). So the `int` gets **boxed** into a `java.lang.Integer` object:

```scala
val x: Int = 42                  // JVM: int (primitive, 4 bytes)
val y: Any = 42                  // JVM: Integer (boxed object, 16 bytes!)
val list: List[Int] = List(1, 2) // JVM: List<Integer> — every element is boxed!
```

**Unboxing** is the reverse: extracting the primitive from the wrapper.

```java
// Java — automatic boxing/unboxing
int a = 5;
Integer b = a;     // Boxing:   int → Integer
int c = b;         // Unboxing: Integer → int
```

**Why this matters**: Boxing creates objects on the heap. In hot loops, this means:
- More GC pressure
- More memory usage (16 bytes per boxed int vs. 4 bytes)
- Cache misses (heap objects scattered in memory vs. contiguous array)

```scala
// Slow: List[Int] is actually List[Integer] — every element is boxed
val sum = (1 to 1_000_000).toList.sum

// Fast: Array[Int] is a real JVM int[] — no boxing
val sum = (1 to 1_000_000).toArray.sum
```

## Type Erasure: Generics Vanish at Runtime

This is the most important thing to understand about JVM types: **generics don't exist at runtime**.

When you write `List[String]` in Scala or `List<String>` in Java, the compiler checks your types at compile time. But in the bytecode, it's just `List`. The type parameter `String` is **erased**.

```scala
val strings: List[String] = List("hello", "world")
val ints: List[Int] = List(1, 2, 3)

// At runtime, both are just "List" — the JVM can't tell them apart
strings.getClass == ints.getClass  // true! Both are scala.collection.immutable.List
```

### Why Erasure?

When Java 5 added generics in 2004, there were billions of lines of existing Java code using raw types (`List` without `<String>`). Sun chose **backward compatibility**: generics were purely a compile-time feature, leaving the bytecode format unchanged. Existing libraries worked without recompilation.

The trade-off: the runtime knows nothing about type parameters.

### Consequences of Erasure

**1. You can't pattern match on type parameters:**

```scala
def check(x: Any): String = x match
  case _: List[String] => "list of strings"   // Warning! Erased type
  case _: List[Int]    => "list of ints"       // Same as above at runtime!
  case _               => "other"

check(List(1, 2, 3))  // Returns "list of strings"!!! Both cases match "List"
```

The compiler will warn you: `non-variable type argument String in type pattern List[String] is unchecked since it is eliminated by erasure`.

**2. You can't create a generic array:**

```java
// Java — doesn't compile
T[] array = new T[10];  // Error: can't create generic array

// Because after erasure, the JVM doesn't know what T is
```

**3. You can't use `instanceof` with type parameters:**

```java
// Java — doesn't compile
if (obj instanceof List<String>) { ... }  // Error: can't check generic type at runtime
```

### Scala's Workarounds for Erasure

Scala provides several mechanisms to fight erasure:

#### `ClassTag` — Runtime class information

```scala
import scala.reflect.ClassTag

def createArray[T: ClassTag](size: Int): Array[T] =
  new Array[T](size)  // Works! ClassTag carries the runtime type

val arr = createArray[Int](10)  // Creates a real int[], not Object[]
```

`ClassTag` is passed as an implicit parameter and carries the runtime class at the call site.

#### `TypeTag` (Scala 2) — Full type information

```scala
import scala.reflect.runtime.universe.*

def typeOf[T: TypeTag]: String =
  implicitly[TypeTag[T]].tpe.toString

typeOf[List[String]]  // "List[String]" — full type info at runtime!
```

`TypeTag` preserves the complete type, including type parameters. However, it's heavy (depends on the Scala reflection library) and was not carried over to Scala 3.

#### Scala 3: `TypeTest` and `Typeable`

Scala 3 replaced `TypeTag` with a simpler mechanism:

```scala
import scala.reflect.TypeTest

def handle[T](x: Any)(using tt: TypeTest[Any, T]): Option[T] =
  x match
    case t: T => Some(t)    // Safe — TypeTest provides the check
    case _    => None
```

#### `inline` and Compile-Time Operations (Scala 3)

Scala 3's `inline` methods can perform type checks at compile time, sidestepping erasure entirely:

```scala
inline def describe[T]: String =
  inline erasedValue[T] match
    case _: Int    => "an integer"
    case _: String => "a string"
    case _         => "something else"

describe[Int]     // Compiled to just: "an integer" — no runtime check
```

## Arrays: The JVM's Only Covariant "Generic"

Arrays are special. They're the only type in the JVM that is:
1. **Reified** — the element type exists at runtime (`int[]` is different from `String[]`)
2. **Covariant** — `String[]` is a subtype of `Object[]` in Java

This covariance is **unsound** and leads to runtime errors:

```java
// Java
String[] strings = {"hello", "world"};
Object[] objects = strings;    // Compiles! Array covariance
objects[0] = 42;               // Compiles! Object[] accepts Integer
// Runtime: ArrayStoreException! The actual array is String[], can't store Integer
```

The JVM checks the actual array type on every store — the **array store check**. This is a runtime overhead that exists solely because of this design mistake.

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

The compiler generates specialized versions for each primitive type:

```
identity(int)    → specialized version, no boxing
identity(long)   → specialized version, no boxing
identity(double) → specialized version, no boxing
identity(Object) → generic version (for reference types)
```

The downside: it creates many versions of the code (up to 9 — one per primitive plus one for objects). With multiple type parameters, this explodes combinatorially.

### Scala 3's `opaque type`

A more elegant approach. Opaque types exist at compile time but are erased to their underlying type at runtime — no boxing, ever:

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

## How Scala Types Map to JVM Types

Here's a reference for how Scala's type system compiles down:

| Scala type               | JVM type                                     | Notes                                             |
| ------------------------ | -------------------------------------------- | ------------------------------------------------- |
| `Int`, `Long`, etc.      | `int`, `long`, etc.                          | Primitive where possible                          |
| `Int` in generic context | `java.lang.Integer`                          | Boxed                                             |
| `String`                 | `java.lang.String`                           | Identical                                         |
| `Unit`                   | `void` (or `BoxedUnit`)                      | Return type = void; value = BoxedUnit singleton   |
| `Nothing`                | (doesn't exist at runtime)                   | Erased — methods returning Nothing actually throw |
| `Null`                   | `null`                                       | The null reference                                |
| `Any`                    | `java.lang.Object`                           | Top type → Object                                 |
| `AnyRef`                 | `java.lang.Object`                           | Same as Any at JVM level                          |
| `AnyVal` subclass        | Erased to underlying type (when possible)    | Boxing in generic contexts                        |
| `List[String]`           | `List` (erased)                              | Type parameter vanishes                           |
| `trait Foo`              | `interface Foo`                              | With default methods (Scala 2.12+)                |
| `object Bar`             | `Bar$` class + `Bar` with static forwarders  | Singleton pattern                                 |
| `case class`             | Regular class + companion object class       | Lots of generated methods                         |
| `enum` (Scala 3)         | Sealed abstract class + case objects/classes | Similar to Java enum for simple cases             |

## Key Takeaways

- The JVM has only **8 primitive types** and **reference types** — that's it
- **Boxing** wraps primitives in objects; it's automatic but costly (4× memory for an `Int`)
- **Type erasure** removes generic type parameters at runtime — `List[String]` and `List[Int]` are the same class
- You can't pattern match on erased types — the compiler warns you
- Scala provides **`ClassTag`**, **`TypeTest`**, and **`inline`** to work around erasure
- Arrays are **reified** (element type known at runtime) and **covariant in Java** (unsound — `ArrayStoreException`)
- Scala makes arrays **invariant** — preventing the unsound covariance
- **`opaque type`** (Scala 3) avoids boxing entirely by being erased to the underlying primitive

---

[← Part IV](index.md) · [Next: Inheritance and Dispatch →](13-inheritance-and-dispatch.md)
