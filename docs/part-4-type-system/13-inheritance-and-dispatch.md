# Chapter 13 — Inheritance and Method Dispatch

[← Previous: Types at Runtime](12-types-at-runtime.md) · [Next: Value Types and Valhalla →](14-value-types-valhalla.md)

---

## How the JVM Finds the Right Method

When you call `animal.speak()`, how does the JVM know which `speak()` to execute? If `animal` is a `Dog`, it should bark. If it's a `Cat`, it should meow. This is **dynamic dispatch** — and it's powered by an internal data structure called the **vtable**.

## The Class Hierarchy on the JVM

The JVM supports:
- **Single class inheritance**: A class can extend exactly one other class
- **Multiple interface inheritance**: A class can implement many interfaces

```java
// Java
class Animal { }
class Dog extends Animal implements Runnable, Serializable { }
```

```scala
// Scala — traits compile to interfaces
trait Speakable:
  def speak(): String

trait Trainable:
  def trick(): String

class Dog extends Animal, Speakable, Trainable:
  def speak(): String = "Woof!"
  def trick(): String = "Roll over"
```

## The Virtual Method Table (vtable)

Every class has a **vtable** — an array of method pointers. When you call a virtual method (`invokevirtual`), the JVM:

1. Gets the object's actual class (from the class pointer in the object header)
2. Looks up the method in that class's vtable at a **fixed index**
3. Calls the method at that index

```
class Animal:
  vtable:
    [0] toString()    → Animal.toString
    [1] equals()      → Object.equals
    [2] speak()       → Animal.speak

class Dog extends Animal:
  vtable:
    [0] toString()    → Dog.toString     (overridden)
    [1] equals()      → Object.equals   (inherited)
    [2] speak()       → Dog.speak       (overridden)
```

The key: the **index is the same** in parent and child. `speak()` is always at index 2, regardless of the actual class. So the dispatch is:

```
1. Read object's class pointer   → Dog
2. Look up vtable[2]             → Dog.speak()
3. Call it
```

This is just an array lookup — extremely fast. One indirection.

### Why Single Inheritance Matters

Because each class extends only one other class, the child's vtable is always a **superset** of the parent's vtable. New methods get appended at the end. Overridden methods replace the pointer at the same index. This makes vtable construction simple and dispatch fast.

## The Interface Method Table (itable)

Interfaces are trickier. A class can implement many interfaces, and different classes might implement the same interface methods at different vtable positions. The JVM can't use a fixed index.

Instead, each class has an **itable** — a list of (interface, method table) pairs:

```
class Dog implements Speakable, Trainable:
  itable:
    Speakable → [speak() → Dog.speak]
    Trainable → [trick() → Dog.trick]
```

When you call a method through an interface reference (`invokeinterface`):

```scala
val s: Speakable = Dog()
s.speak()  // invokeinterface
```

1. Get the object's actual class → `Dog`
2. Search the itable for the `Speakable` entry
3. Look up `speak()` in that entry's method table
4. Call it

This is slower than vtable lookup because of the itable search. The JVM caches the result to speed up repeated calls, but `invokeinterface` is inherently more expensive than `invokevirtual`.

> **Performance tip**: If you notice that a hot method is dispatched via `invokeinterface` and it's a performance bottleneck, consider whether you can use a concrete class type instead of an interface type at the call site. The JIT compiler can often devirtualize interface calls if it profiles that only one implementation is used.

## Default Methods (Java 8+)

Before Java 8, interfaces could only have abstract methods. Java 8 added **default methods** — concrete methods in interfaces:

```java
interface Speakable {
    default String speak() {
        return "...";
    }
}
```

At the JVM level, default methods live in the interface itself. When a class implements the interface but doesn't override the default method, the JVM resolves the call to the interface's implementation.

### The Diamond Problem

What if two interfaces provide default methods with the same signature?

```java
interface A {
    default String greet() { return "Hello from A"; }
}

interface B {
    default String greet() { return "Hello from B"; }
}

class C implements A, B {
    // Java FORCES you to override and resolve the conflict:
    @Override
    public String greet() {
        return A.super.greet();  // Explicitly choose A's version
    }
}
```

The JVM spec defines resolution rules:
1. Class methods win over interface default methods
2. More specific interfaces win over less specific ones
3. If ambiguous, the compiler forces you to resolve it

## How Scala Traits Compile

Scala traits have always supported concrete methods (since 2004 — a decade before Java's default methods). How they compile has evolved:

### Scala 2.12+ (targeting Java 8+)

Traits compile to **Java interfaces with default methods**:

```scala
trait Greeter:
  def greet(name: String): String = s"Hello, $name!"
  def farewell(name: String): String  // abstract
```

Compiles to:

```java
// Bytecode equivalent
public interface Greeter {
    default String greet(String name) {
        return "Hello, " + name + "!";
    }
    String farewell(String name);  // abstract
}
```

Clean and efficient. The JVM handles the dispatch natively.

### Before Scala 2.12 (targeting Java 6/7)

Before default methods existed, Scala used a workaround. Each trait generated:
1. An interface (with abstract methods only)
2. A companion **static class** containing the concrete implementations

```java
// Trait Greeter generated TWO classes:

// 1. The interface
public interface Greeter {
    String greet(String name);  // Abstract!
    String farewell(String name);
}

// 2. Static implementation holder
public abstract class Greeter$class {
    public static String greet(Greeter self, String name) {
        return "Hello, " + name + "!";
    }
}
```

And every class that mixed in `Greeter` got a **forwarder method**:

```java
public class MyClass implements Greeter {
    public String greet(String name) {
        return Greeter$class.greet(this, name);  // Forward to static
    }
}
```

This was verbose and added indirection. The switch to default methods in 2.12 was a significant improvement.

### Traits with State

Traits can have fields (vals and vars). These compile to:

```scala
trait Counter:
  var count: Int = 0
  def increment(): Unit = count += 1
```

Since Java interfaces can't have instance fields, Scala generates:
- Abstract getter/setter methods in the interface
- The actual field and getter/setter in the implementing class
- An initialization hook

```java
// Interface
public interface Counter {
    int count();                    // getter
    void count_$eq(int x);        // setter
    default void increment() {
        count_$eq(count() + 1);
    }
}

// Implementing class gets the field
public class MyCounter implements Counter {
    private int count = 0;          // Actual field
    public int count() { return this.count; }
    public void count_$eq(int x) { this.count = x; }
}
```

## Linearization: Scala's Resolution of Multiple Inheritance

Scala resolves the diamond problem through **linearization** — a deterministic ordering of all classes and traits in the hierarchy:

```scala
trait A:
  def greet: String = "A"

trait B extends A:
  override def greet: String = "B"

trait C extends A:
  override def greet: String = "C"

class D extends B, C  // Which greet?
```

Scala computes a linearization order using C3 linearization:
```
D → C → B → A → AnyRef → Any
```

The rightmost trait in the `extends` clause that overrides `greet` wins. So `D.greet` returns `"C"`.

You can call `super` to go up the chain:

```scala
trait B extends A:
  override def greet: String = s"B -> ${super.greet}"

trait C extends A:
  override def greet: String = s"C -> ${super.greet}"

class D extends B, C

D().greet  // "C -> B -> A"
```

This is called **stackable trait pattern** and is one of Scala's powerful composition mechanisms.

At the bytecode level, this compiles to a chain of default method calls. The Scala compiler resolves the linearization at compile time and generates the appropriate `invokeinterface` calls.

## Static Dispatch

Not all calls go through vtable/itable lookup. Some are resolved at compile time:

| Bytecode          | Dispatch         | When                                                |
| ----------------- | ---------------- | --------------------------------------------------- |
| `invokestatic`    | Static           | Static methods (`Math.max`, Scala `object` methods) |
| `invokespecial`   | Static           | Constructors, `super` calls, `private` methods      |
| `invokevirtual`   | Dynamic (vtable) | Regular instance methods                            |
| `invokeinterface` | Dynamic (itable) | Methods called via interface type                   |
| `invokedynamic`   | Custom           | Lambdas, dynamic languages                          |

The JIT compiler can **devirtualize** dynamic calls when it profiles that only one implementation is used — effectively converting `invokevirtual` into a direct call (or even inlining the method body).

## Sealed Hierarchies and the JIT

Sealed traits/classes give the compiler (and potentially the JIT) a closed set of implementations:

```scala
sealed trait Shape
case class Circle(radius: Double) extends Shape
case class Square(side: Double) extends Shape
```

Since no other class can extend `Shape`, the JIT can be more aggressive:
- It knows there are only two subtypes
- Pattern matching compiles to just two `instanceof` checks
- Devirtualization is more likely because the type set is small and known

Java's `sealed` classes (Java 17) provide the same benefit on the Java side.

## Key Takeaways

- **vtable**: Fixed-index method array for class method dispatch — fast (single indirection)
- **itable**: Per-interface method lookup for interface dispatch — slower than vtable
- **Default methods** (Java 8) enabled Scala traits to compile directly to interfaces
- Before Scala 2.12, traits used a **static forwarder** pattern (more complex, slower)
- Scala resolves multiple inheritance via **linearization** (C3 algorithm)
- The JIT can **devirtualize** calls when only one implementation is observed
- **Sealed hierarchies** help both the compiler and JIT optimize dispatch

---

[← Previous: Types at Runtime](12-types-at-runtime.md) · [Next: Value Types and Valhalla →](14-value-types-valhalla.md)
