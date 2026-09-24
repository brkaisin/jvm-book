# Chapter 13 — Inheritance and Method Dispatch

## How the JVM Finds the Right Method

When you call `animal.speak()`, how does the JVM know which `speak()` to execute? If `animal` is a `Dog`, it should bark. If it's a `Cat`, it should meow. This is **dynamic dispatch**. In the interpreter it's powered by tables attached to every class — the **vtable** and the **itable**. In hot, JIT-compiled code it is usually optimized away almost entirely.

## The Class Hierarchy on the JVM

The JVM supports:

- **Single class inheritance**: a class extends exactly one other class
- **Multiple interface inheritance**: a class can implement many interfaces

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

As the JVM sees the Scala version:

```text
      ┌──────────┐
      │ Object   │
      └────▲─────┘
           │ extends
      ┌────┴─────┐       ┌─────────────────┐   ┌─────────────────┐
      │ Animal   │       │ <<interface>>   │   │ <<interface>>   │
      └────▲─────┘       │ Speakable       │   │ Trainable       │
           │             ├─────────────────┤   ├─────────────────┤
           │ extends     │ +speak() String │   │ +trick() String │
           │             └────────▲────────┘   └────────▲────────┘
           │                      ┆ implements          ┆ implements
      ┌────┴────────────┐         ┆                     ┆
      │ Dog             │╌╌╌╌╌╌╌╌╌┘                     ┆
      ├─────────────────┤                               ┆
      │ +speak() String │╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
      │ +trick() String │
      └─────────────────┘
```

One solid line upwards (the single superclass chain), any number of dotted lines to interfaces.

## The Virtual Method Table (vtable)

Every class has a **vtable** — an array of pointers to its overridable methods. When you call a virtual method (`invokevirtual`), the JVM:

1. Gets the object's actual class from the object header (a compressed class pointer, or — with compact object headers, the default since JDK 27 — a class index packed into the header word; see [Chapter 8](../part-3-memory-and-gc/08-object-layout.md))
2. Looks up the method in that class's vtable at a **fixed index**
3. Calls the method at that index

(Indices below are illustrative; the real order depends on `Object`'s methods and the JVM.)

| Index | Method       | `Animal` vtable   | `Dog` vtable                 |
| ----- | ------------ | ----------------- | ---------------------------- |
| 0     | `toString()` | `Object.toString` | `Dog.toString` (overridden)  |
| 1     | `equals()`   | `Object.equals`   | `Object.equals` (inherited)  |
| 2     | `hashCode()` | `Object.hashCode` | `Object.hashCode` (inherited)|
| 3     | `speak()`    | `Animal.speak`    | `Dog.speak` (overridden)     |
| 4     | `fetch()`    | —                 | `Dog.fetch` (new, appended)  |

The key: the **index is the same** in parent and child. `speak()` is always at index 3, regardless of the actual class. So the dispatch is:

```text
1. Read the object's class from its header   → Dog
2. Load Dog.vtable[3]                        → Dog.speak()
3. Call it
```

Two dependent memory loads and an indirect call. Cheap — but not free, because an indirect call can't be inlined.

Methods that can't be overridden — `final` methods, `private` methods, and methods of `final` classes — don't need a vtable slot at all: the JVM binds them directly.

### Why Single Inheritance Matters

Because each class extends only one other class, the child's vtable is always a **prefix-compatible superset** of the parent's vtable. New methods get appended at the end. Overridden methods replace the pointer at the same index. This makes vtable construction simple and dispatch fast.

## The Interface Method Table (itable)

Interfaces are trickier. A class can implement many interfaces, and unrelated classes implement the same interface at different vtable positions. The JVM can't use one fixed index.

Instead, each class also has an **itable**: a list of (interface → method table) entries. For a `Dog` that implements `Speakable`, `Trainable`, and `Runnable`:

```text
Dog itable:
┌─────────────┬────────────────────────────┐
│ Speakable   │ [0] speak() → Dog.speak    │
├─────────────┼────────────────────────────┤
│ Trainable   │ [0] trick() → Dog.trick    │
├─────────────┼────────────────────────────┤
│ Runnable    │ [0] run()   → Dog.run      │
└─────────────┴────────────────────────────┘
```

When you call a method through an interface reference (`invokeinterface`):

```scala
val s: Speakable = Dog()
s.speak()  // invokeinterface Speakable.speak
```

1. Get the object's actual class → `Dog`
2. **Scan** the itable for the `Speakable` entry
3. Load `speak()` at its fixed index within that entry
4. Call it

Step 2 is a search, which is why a raw `invokeinterface` is more expensive than a raw `invokevirtual`. In practice, though, raw lookups are the slow path: most call sites never get there, thanks to the tricks in the next section.

## What the JIT Does With Virtual Calls

Here's the secret: in hot code, the JVM almost never does a full vtable or itable lookup. HotSpot combines three techniques.

**1. Profiling.** While a method runs in the interpreter and in C1-compiled code, the JVM records which receiver classes actually show up at each call site.

**2. Class Hierarchy Analysis (CHA).** The JVM knows every class loaded so far. If `Animal.speak()` has no loaded overrides, a call to it can only go one place — so C2 calls (and usually inlines) it directly, and records a *dependency*. If a class that overrides `speak()` is loaded later, the compiled code is **deoptimized** and recompiled. For interfaces, the JVM tracks the common case of an interface with exactly one implementing class.

**3. Inline caches and guarded inlining.** For call sites that really are polymorphic, the profile decides:

```text
                  ┌────────────────────────────────┐
                  │ Virtual or interface call site │
                  └───────────────┬────────────────┘
                                  ▼
       ┌─────────────────────────────────────────────────────┐
       │ Receiver classes seen in the profile?               │
       └──┬───────────────────────┬───────────────────────┬──┘
          │ 1 (monomorphic)       │ 2 (bimorphic)         │ 3 or more
          ▼                       ▼                       ▼ (megamorphic)
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Inline the       │    │ Inline both      │    │ Real vtable or   │
│ target behind a  │    │ targets behind a │    │ itable lookup    │
│ cheap class      │    │ two-way class    │    │ (no inlining)    │
│ check            │    │ check            │    └──────────────────┘
└────────┬─────────┘    └────────┬─────────┘
         │ unexpected class      │ unexpected class
         │ shows up              │ shows up
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │ Uncommon trap:        │
         │ deoptimize, recompile │
         └───────────────────────┘
```

A monomorphic call compiles to roughly this:

```text
if (receiver.klass == Dog) {
    ...body of Dog.speak() inlined here...
} else {
    uncommon_trap()   // bail out to the interpreter
}
```

That's one compare and a well-predicted branch — and, more importantly, inlining opens the door to every other optimization (escape analysis, constant folding, and so on). This is also why `invokeinterface` vs `invokevirtual` rarely matters in practice: both become the same guarded, inlined code when the call site sees one or two classes.

> [!TIP]
> The costly case is a **megamorphic** call site — one hot line of code that sees many receiver classes, like a generic `map` over a heterogeneous list of `Function1` implementations. If a profiler shows time in `vtable stub` or `itable stub` frames, that's the smell. Splitting the call site by type (or making it monomorphic) helps far more than switching from a trait to a class.

## invokedynamic: Dispatch You Program Yourself

The four classic invoke instructions each hard-code a linkage rule. `invokedynamic` (Java 7) instead asks a user-supplied **bootstrap method** how to link the call site, the first time it executes. The bootstrap returns a `CallSite` holding a `MethodHandle`; from then on the JVM calls that target directly, and the JIT can inline straight through it.

```text
 Call site                   JVM                     Bootstrap method
     │                        │                              │
     │ first execution of     │                              │
     │ invokedynamic          │                              │
     │───────────────────────▶│                              │
     │                        │ bootstrap(lookup, name,      │
     │                        │   type, extra args)          │
     │                        │─────────────────────────────▶│
     │                        │                              │
     │                        │ CallSite wrapping a          │
     │                        │ MethodHandle                 │
     │                        │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│
     │ link the call site to  │                              │
     │ that target            │                              │
     │◀───────────────────────│                              │
     │                        │                              │
     │ later executions       │                              │
     │───────────────────────▶│                              │
  ┌──┴────────────────────────┴──┐                           │
  │ direct call to the target,   │                           │
  │ inlinable by the JIT         │                           │
  └──────────────────────────────┘                           │
```

It started as a feature for dynamic languages (JRuby, Groovy), but today it's everywhere in Java and Scala bytecode:

| Use                                   | Bootstrap                                       | Since   |
| ------------------------------------- | ----------------------------------------------- | ------- |
| Java and Scala lambdas                | `LambdaMetafactory.metafactory`                 | Java 8, Scala 2.12 |
| String concatenation (`"a" + b`)      | `StringConcatFactory.makeConcatWithConstants`   | Java 9  |
| Record `equals`/`hashCode`/`toString` | `ObjectMethods.bootstrap`                       | Java 16 |
| Pattern `switch` (type patterns)      | `SwitchBootstraps.typeSwitch`                   | Java 21 |

The payoff is flexibility: the strategy lives in the JDK library, not in your class file. When the JDK improves its string concatenation or switch strategy, old class files get faster without recompiling.

## Default Methods (Java 8+)

Before Java 8, interfaces could only have abstract methods. Java 8 added **default methods** — concrete methods in interfaces:

```java
interface Speakable {
    default String speak() {
        return "...";
    }
}
```

At the JVM level, default methods live in the interface itself. When a class implements the interface but doesn't override the method, the JVM fills the class's vtable and itable slots with the interface's implementation when it links the class.

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

The resolution rules:

1. Class methods win over interface default methods
2. A more specific interface wins over the interface it extends
3. If it's still ambiguous, `javac` makes you resolve it. If an ambiguity only appears later (a library adds a default method and your class isn't recompiled), the call fails at runtime with an `IncompatibleClassChangeError`.

## How Scala Traits Compile

Scala traits have always supported concrete methods (since 2004 — a decade before Java's default methods). How they compile has evolved.

### Scala 2.12+ and Scala 3

Traits compile to **Java interfaces with default methods**:

```scala
trait Greeter:
  def greet(name: String): String = s"Hello, $name!"
  def farewell(name: String): String  // abstract
```

Roughly compiles to:

```java
// Bytecode equivalent (Scala 2.12+)
public interface Greeter {
    // The body lives in the default method...
    default String greet(String name) {
        return "Hello, " + name + "!";
    }
    // ...plus a static accessor that calls it non-virtually
    // (pseudo-Java: in bytecode this is an invokespecial of Greeter.greet)
    static String greet$(Greeter $this, String name) {
        return $this.Greeter.super.greet(name);
    }
    String farewell(String name);  // abstract
}

// ...and each class mixing in the trait gets a small forwarder:
public class MyGreeter implements Greeter {
    public String greet(String name) { return Greeter.greet$(this, name); }
    public String farewell(String name) { return "Bye, " + name; }
}
```

Two details differ from what a Java developer might expect:

- The static `greet$` accessor gives forwarders and `super.greet(...)` calls from subtraits a fixed, non-virtual target (`invokestatic`), which matters for the stackable-trait pattern below.
- By default the compiler still emits **mixin forwarders** in classes. They cost a tiny bit of bytecode, but they give the class a real vtable entry and avoid corner cases in the JVM's default-method resolution.

The details of the generated code differ between Scala 2.12/2.13 and Scala 3, and they aren't part of any spec — use `javap -p` on your own classes when it matters.

### Before Scala 2.12 (targeting Java 6/7)

Before default methods existed, each trait generated:

1. An interface (with abstract methods only)
2. A separate `Greeter$class` holding the concrete implementations as static methods

```java
// Trait Greeter generated TWO class files:

// 1. The interface
public interface Greeter {
    String greet(String name);  // abstract!
    String farewell(String name);
}

// 2. Static implementation holder
public abstract class Greeter$class {
    public static String greet(Greeter self, String name) {
        return "Hello, " + name + "!";
    }
}
```

Every class that mixed in `Greeter` got a forwarder calling `Greeter$class.greet(this, name)`. This worked, but adding a method to a trait broke binary compatibility for every class that mixed it in. Default methods fixed much of that.

### Traits with State

Traits can have fields (`val`s and `var`s):

```scala
trait Counter:
  var count: Int = 0
  def increment(): Unit = count += 1
```

Since Java interfaces can't have instance fields, Scala generates:

- Abstract getter/setter methods in the interface
- The actual field and getter/setter in each implementing class
- A static `$init$` method in the interface, called from the class constructor, that runs the trait's initializers

```java
// Interface
public interface Counter {
    int count();                    // getter
    void count_$eq(int x);          // setter
    default void increment() {
        count_$eq(count() + 1);
    }
    static void $init$(Counter $this) {
        $this.count_$eq(0);         // trait initializer
    }
}

// Implementing class gets the field
public class MyCounter implements Counter {
    private int count;              // actual field
    public int count() { return this.count; }
    public void count_$eq(int x) { this.count = x; }
    public MyCounter() { super(); Counter.$init$(this); }
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

```text
Declared hierarchy            Linearization of D

 ┌───────────┐
 │     A     │                D ──▶ C ──▶ B ──▶ A ──▶ AnyRef ──▶ Any
 └──▲─────▲──┘
    │     │
  ┌─┴─┐ ┌─┴─┐
  │ B │ │ C │
  └─▲─┘ └─▲─┘
    │     │
 ┌──┴─────┴──┐
 │     D     │
 └───────────┘
```

Scala's own linearization algorithm (similar in spirit to Python's C3, but not identical) produces `D → C → B → A → AnyRef → Any`. The rightmost trait in the `extends` clause comes first, so `D().greet` returns `"C"`.

`super` means "the next one in the linearization", not "my declared parent":

```scala
trait B extends A:
  override def greet: String = s"B -> ${super.greet}"

trait C extends A:
  override def greet: String = s"C -> ${super.greet}"

class D extends B, C

D().greet  // "C -> B -> A"
```

This is the **stackable trait pattern**, one of Scala's most powerful composition mechanisms. The compiler resolves the linearization at compile time: each `super.greet` compiles to a direct (static) call to the next trait's implementation method, not a virtual lookup.

## Summary: The Five Invoke Instructions

| Bytecode          | Dispatch          | Used for                                                              |
| ----------------- | ----------------- | --------------------------------------------------------------------- |
| `invokestatic`    | Static            | Static methods (`Math.max`, Scala static forwarders, trait `$` impls) |
| `invokespecial`   | Static            | Constructors, `super.m()` calls                                       |
| `invokevirtual`   | Dynamic (vtable)  | Instance methods on a class type                                      |
| `invokeinterface` | Dynamic (itable)  | Methods called via an interface type                                  |
| `invokedynamic`   | Programmable      | Lambdas, string concatenation, records, pattern `switch`              |

> [!NOTE]
> `private` methods used to be called with `invokespecial`. Since Java 11 (JEP 181, nest-based access control), `javac` calls them with `invokevirtual` (or `invokeinterface` in an interface) so that nested classes can call each other's private members directly. The JVM still binds these calls directly, since private methods can't be overridden.

## Sealed Hierarchies

Sealed traits and classes give the *compiler* a closed set of implementations:

```scala
sealed trait Shape
case class Circle(radius: Double) extends Shape
case class Square(side: Double) extends Shape
```

```java
sealed interface Shape permits Circle, Square {}
record Circle(double radius) implements Shape {}
record Square(double side) implements Shape {}
```

What that buys you:

- **Exhaustiveness checking**: a `match` (Scala) or pattern `switch` (Java 21+) that forgets a case is a warning or an error, and a Java switch over a sealed type needs no `default`.
- **Enforcement at runtime** (Java): since Java 17, `javac` writes a `PermittedSubclasses` attribute into the class file, and the JVM refuses to load any other class that tries to extend it. In Scala 2 and Scala 3, `sealed` is checked by the compiler.

What it doesn't buy you is a faster JIT. HotSpot doesn't need `sealed` to devirtualize: CHA and receiver profiling already know which classes are loaded and which actually show up. A `match` over a sealed trait with two cases compiles to two `instanceof` checks either way.

<div class="takeaways">

## Key Takeaways

- **vtable**: fixed-index method array for class dispatch — two loads and an indirect call
- **itable**: per-interface tables for interface dispatch — needs a search, so raw `invokeinterface` is slower
- In hot code, the JIT avoids both: **CHA**, **receiver profiles**, and **guarded inlining** turn most virtual calls into direct, inlined code; only **megamorphic** call sites pay full price
- **`invokedynamic`** lets a bootstrap method decide how to link a call site — it powers lambdas, string concatenation, record methods, and pattern `switch`
- **Default methods** (Java 8) let Scala 2.12+ compile traits to interfaces, with static `$` implementation methods and mixin forwarders
- Scala resolves multiple inheritance via **linearization**; `super` means "next in the linearization"
- **Sealed hierarchies** give exhaustiveness checks (and, in Java, a `PermittedSubclasses` check at class loading), not a faster JIT

</div>
