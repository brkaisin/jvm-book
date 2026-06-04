# Chapter 5 — Bytecode: The JVM's Native Language

[← Previous: Class Loaders](04-class-loaders.md) · [Next: Runtime Data Areas →](06-runtime-data-areas.md)

---

## What Is Bytecode?

Bytecode is the instruction set of the JVM — a set of about 200 simple operations that tell the virtual machine what to do. Every JVM language (Java, Scala, Kotlin, Clojure) compiles down to these same instructions.

Think of bytecode like a recipe written in a universal language that every kitchen (JVM implementation) can follow, regardless of what country the chef (programmer) is from.

Each bytecode instruction is one byte (hence the name), optionally followed by operands. The JVM's theoretical maximum is 256 instructions; about 200 are defined.

## Stack-Based Architecture

The JVM is a **stack-based** virtual machine. This means it doesn't have general-purpose registers like a real CPU. Instead, each method has an **operand stack** that instructions push values onto and pop values from.

Let's see this with the simplest possible example — adding two numbers:

```java
int result = 1 + 2;
```

This compiles to:

```
iconst_1        // Push the integer constant 1 onto the stack
iconst_2        // Push the integer constant 2 onto the stack
iadd            // Pop two integers, add them, push the result (3)
istore_1        // Pop the result and store it in local variable 1
```

Visually:

```
Step 1: iconst_1       Step 2: iconst_2       Step 3: iadd         Step 4: istore_1
┌───┐                  ┌───┐                  ┌───┐                ┌───┐
│   │                  │ 2 │                  │ 3 │                │   │
│ 1 │                  │ 1 │                  │   │                │   │
└───┘                  └───┘                  └───┘                └───┘
 Stack                  Stack                  Stack                Stack

                                                                   locals[1] = 3
```

> **Contrast with real CPUs**: x86 and ARM are *register-based*. They'd express this as `add r1, r2, r3` — "add registers r2 and r3, put result in r1." Android's old Dalvik VM was register-based too. Stack-based is simpler to implement and generates more compact bytecode, but register-based can be faster. The JIT compiler ultimately converts stack operations to register operations for the real CPU.

## Your First Bytecode Disassembly

Let's look at real bytecode. Here's a simple Java method:

```java
public class Calculator {
    public static int multiply(int a, int b) {
        return a * b;
    }
}
```

Compile and disassemble:

```bash
javac Calculator.java
javap -c Calculator
```

Output:

```
public static int multiply(int, int);
  Code:
     0: iload_0      // Load first parameter (a) onto the stack
     1: iload_1      // Load second parameter (b) onto the stack
     2: imul         // Pop both, multiply, push result
     3: ireturn      // Pop result and return it
```

Now the exact same thing in Scala:

```scala
object Calculator:
  def multiply(a: Int, b: Int): Int = a * b
```

Disassemble with `javap -c`:

```
public static int multiply(int, int);
  Code:
     0: iload_0
     1: iload_1
     2: imul
     3: ireturn
```

**Identical bytecode.** The JVM cannot distinguish which language produced this.

## Bytecode Instruction Categories

Let's tour the main families of instructions. You don't need to memorize these — just get a feel for what's available.

### Load and Store

Move values between the operand stack and local variables:

| Instruction | Meaning                                             |
| ----------- | --------------------------------------------------- |
| `iload_0`   | Load `int` from local variable 0 onto the stack     |
| `aload_1`   | Load object reference from local variable 1         |
| `istore_2`  | Pop `int` from stack, store in local variable 2     |
| `astore_3`  | Pop reference from stack, store in local variable 3 |

The prefix tells you the type: `i` = int, `l` = long, `f` = float, `d` = double, `a` = reference (object).

### Constants

Push constant values onto the stack:

| Instruction                   | Meaning                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| `iconst_0` through `iconst_5` | Push int 0–5                                                  |
| `bipush 42`                   | Push byte value as int                                        |
| `ldc "hello"`                 | Load constant from the constant pool (strings, large numbers) |
| `aconst_null`                 | Push `null`                                                   |

### Arithmetic

| Instruction                    | Meaning                        |
| ------------------------------ | ------------------------------ |
| `iadd`, `ladd`, `fadd`, `dadd` | Add (int, long, float, double) |
| `isub`, `imul`, `idiv`         | Subtract, multiply, divide     |
| `irem`                         | Remainder (modulo)             |
| `ineg`                         | Negate                         |

### Comparison and Branching

```java
if (a > b) {
    return a;
} else {
    return b;
}
```

Bytecode:

```
0: iload_0           // Load a
1: iload_1           // Load b
2: if_icmple 7       // If a <= b, jump to instruction 7
5: iload_0           // Load a (the "then" branch)
6: ireturn           // Return a
7: iload_1           // Load b (the "else" branch)
8: ireturn           // Return b
```

| Instruction | Meaning                      |
| ----------- | ---------------------------- |
| `if_icmpeq` | Jump if two ints are equal   |
| `if_icmpgt` | Jump if first > second       |
| `ifnull`    | Jump if top of stack is null |
| `goto`      | Unconditional jump           |

### Object Operations

| Instruction               | Meaning                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| `new`                     | Allocate memory for a new object (doesn't call constructor yet!)      |
| `invokespecial`           | Call constructor (`<init>`), or `super` methods, or `private` methods |
| `getfield` / `putfield`   | Access/set instance fields                                            |
| `getstatic` / `putstatic` | Access/set static fields                                              |
| `instanceof`              | Check if an object is an instance of a class                          |
| `checkcast`               | Cast an object to a type (throws `ClassCastException` on failure)     |

Creating a new object is actually a two-step process:

```java
new ArrayList()
```

Bytecode:

```
0: new           #2    // Allocate ArrayList (returns uninitialized reference)
3: dup                 // Duplicate the reference (one for the constructor, one to keep)
4: invokespecial #3    // Call ArrayList.<init>() (the constructor)
```

Why `dup`? Because `invokespecial` (the constructor call) *consumes* the reference from the stack. You need a copy to work with afterward.

## The Five Invoke Instructions

Method calls are the most interesting bytecodes, and there are five kinds:

### `invokevirtual` — Standard method calls

```java
object.toString()  // invokevirtual — dispatched at runtime based on actual type
```

This is the standard **virtual dispatch**: the JVM looks at the actual object's class (not the declared type) to find the method. This is how polymorphism works.

### `invokeinterface` — Interface method calls

```java
list.size()  // list is declared as List (interface), not ArrayList
```

Similar to `invokevirtual` but for interface types. The lookup mechanism is different internally (itable vs vtable — see [Chapter 13](../part-4-type-system/13-inheritance-and-dispatch.md)).

### `invokestatic` — Static method calls

```java
Math.max(1, 2)  // invokestatic — no instance needed, resolved at compile time
```

No dispatch needed — the method is known at compile time.

### `invokespecial` — Constructors, super calls, private methods

```java
super.toString()  // invokespecial — don't do virtual dispatch, go directly to super
```

Bypasses virtual dispatch. Used when you need to call a *specific* method (not the overridden version).

### `invokedynamic` — The Game Changer

Added in Java 7, this is the most fascinating bytecode instruction. Unlike the other four, it doesn't resolve the method at compile time. Instead, it calls a **bootstrap method** the first time, which returns a `CallSite` — essentially a function pointer that the JVM can then call directly on subsequent invocations.

**Why does this matter?**

Before `invokedynamic`, every method call had to go through the class hierarchy. Lambdas, closures, and dynamic languages didn't fit this model well. `invokedynamic` lets the language runtime decide *at the first call* how to handle the invocation, and then the JVM optimizes it just as aggressively as any other call.

**Java lambdas use it:**

```java
Runnable r = () -> System.out.println("Hello");
```

Bytecode:

```
0: invokedynamic #2, 0  // InvokeDynamic #0:run:()Ljava/lang/Runnable;
```

The bootstrap method creates a lightweight implementation on the fly — no anonymous inner class needed.

**Scala lambdas use it too** (since Scala 2.12):

```scala
val f: Int => Int = x => x + 1
```

Before Scala 2.12, this created an anonymous class for every lambda. Since 2.12, Scala emits `invokedynamic` just like Java 8, making lambdas much cheaper.

> **Fun fact**: `invokedynamic` was originally designed for JRuby and other dynamic languages on the JVM. Its adoption for Java/Scala lambdas was a brilliant repurposing that nobody initially planned.

## Scala-Specific Bytecode Patterns

Scala generates some distinctive bytecode patterns. Let's examine a few.

### Case Classes

```scala
case class Point(x: Int, y: Int)
```

This single line generates bytecode for:
- A class with `private final` fields `x` and `y`
- Getter methods `x()` and `y()`
- `equals()` — structural equality comparing all fields
- `hashCode()` — based on all fields
- `toString()` — `"Point(1, 2)"`
- `copy()` — create a new instance with some fields changed
- A companion object with `apply()` (factory) and `unapply()` (pattern matching extractor)
- `Serializable` and `Product` interface implementations

```bash
# See all the generated methods
javap -p Point.class
```

```
public class Point implements scala.Product,java.io.Serializable {
  private final int x;
  private final int y;
  public int x();
  public int y();
  public Point copy(int, int);
  public int copy$default$1();
  public int copy$default$2();
  public java.lang.String productPrefix();
  public int productArity();
  public java.lang.Object productElement(int);
  public scala.collection.Iterator<java.lang.Object> productIterator();
  public boolean canEqual(java.lang.Object);
  public java.lang.String toString();
  public int hashCode();
  public boolean equals(java.lang.Object);
  public Point(int, int);
}
```

Java's `record` generates a similar but smaller set of methods (no `copy`, no `Product`, no `unapply`).

### Traits

Scala traits compile differently depending on the Scala version:

**Scala 2.12+**: A trait with concrete methods compiles to a Java interface with `default` methods:

```scala
trait Greeter:
  def greet(name: String): String = s"Hello, $name!"
```

Becomes:

```
public interface Greeter {
  default java.lang.String greet(java.lang.String);
}
```

**Before Scala 2.12**: Concrete methods lived in a separate static class (`Greeter$class`), and implementing classes got static forwarder methods. This was more complex and slower.

### Pattern Matching

```scala
def describe(x: Any): String = x match
  case i: Int if i > 0 => "positive int"
  case s: String       => s"string: $s"
  case _               => "something else"
```

This compiles to a chain of `instanceof` checks and conditional branches — essentially a series of `if/else if` blocks:

```
0: aload_1
1: instanceof    #2  // class java/lang/Integer
4: ifeq          28  // not an Int? jump to next case
7: checkcast     #2  // cast to Integer
10: invokevirtual #3 // unbox: Integer.intValue()
13: istore_2         // store in local var
14: iload_2
15: ifle         28   // if <= 0, jump (guard failed)
18: ldc          #4   // "positive int"
20: areturn
...
```

## The Constant Pool

Every `.class` file has a **constant pool** — a table of all the constants, class names, method names, field names, and type descriptors used in the class. Bytecode instructions reference the constant pool by index.

```bash
javap -v Calculator.class  # -v for verbose, includes constant pool
```

```
Constant pool:
   #1 = Methodref    #5.#14    // java/lang/Object."<init>":()V
   #2 = Class        #15       // Calculator
   #3 = Class        #16       // java/lang/Object
   ...
   #15 = Utf8        Calculator
   #16 = Utf8        java/lang/Object
```

When bytecode says `invokevirtual #7`, it means "look up entry #7 in the constant pool to find which method to call."

## Bytecode Tools

Here are the tools you'll use to explore bytecode:

| Tool              | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `javap -c`        | Basic disassembly — show instructions                           |
| `javap -v`        | Verbose — includes constant pool, line numbers, stack map table |
| `javap -p`        | Show private members too                                        |
| `ASM` library     | Programmatic bytecode manipulation (used by many frameworks)    |
| `ByteBuddy`       | Higher-level bytecode generation                                |
| `cfr` / `procyon` | Decompilers — go from bytecode back to Java source              |

> **Tip for Scala devs**: When debugging a mysterious runtime behavior, `javap -c -p` on the compiled class is incredibly revealing. You'll see exactly what the Scala compiler generated — including things you didn't expect (bridge methods, boxing conversions, synthetic accessors).

## Key Takeaways

- Bytecode is the JVM's instruction set: ~200 instructions, each one byte
- The JVM is **stack-based**: instructions push and pop from an operand stack
- There are **five invoke instructions**: `invokevirtual`, `invokeinterface`, `invokestatic`, `invokespecial`, and `invokedynamic`
- **`invokedynamic`** (Java 7) was a watershed: it enabled efficient lambdas and flexible method dispatch
- Scala and Java produce **identical bytecode** for equivalent operations
- Scala generates **more bytecode** per line of source (case classes, traits, pattern matching)
- `javap -c` is your best friend for understanding what the compiler actually generates

---

[← Previous: Class Loaders](04-class-loaders.md) · [Next: Runtime Data Areas →](06-runtime-data-areas.md)
