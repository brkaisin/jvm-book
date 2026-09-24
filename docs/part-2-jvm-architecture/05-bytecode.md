# Chapter 5 — Bytecode: The JVM's Native Language

## What Is Bytecode?

Bytecode is the instruction set of the JVM — a set of about 200 simple operations that tell the virtual machine what to do. Every JVM language (Java, Scala, Kotlin, Clojure) compiles down to these same instructions.

Think of bytecode like a recipe written in a universal language that every kitchen (JVM implementation) can follow, regardless of what country the chef (programmer) is from.

Each bytecode instruction is identified by a one-byte **opcode** (hence the name), optionally followed by operands. One byte allows 256 opcodes; just over 200 are defined, and the rest are unused or reserved.

## Stack-Based Architecture

The JVM is a **stack-based** virtual machine. This means it doesn't have general-purpose registers like a real CPU. Instead, each method has an **operand stack** that instructions push values onto and pop values from.

Let's see this with the simplest possible example — adding two numbers:

```java
int result = 1 + 2;
```

This compiles to (conceptually — `javac` would actually fold `1 + 2` into the constant `3`):

```text
iconst_1        // Push the integer constant 1 onto the stack
iconst_2        // Push the integer constant 2 onto the stack
iadd            // Pop two integers, add them, push the result (3)
istore_1        // Pop the result and store it in local variable 1
```

Visually:

```text
Step 1: iconst_1       Step 2: iconst_2       Step 3: iadd         Step 4: istore_1
┌───┐                  ┌───┐                  ┌───┐                ┌───┐
│   │                  │ 2 │                  │   │                │   │
│ 1 │                  │ 1 │                  │ 3 │                │   │
└───┘                  └───┘                  └───┘                └───┘
 Stack                  Stack                  Stack                Stack

                                                                   locals[1] = 3
```

> **Contrast with real CPUs**: x86 and ARM are *register-based*. They'd express this as `add r1, r2, r3` — "add registers r2 and r3, put result in r1." Android's Dalvik/ART bytecode is register-based too. Stack-based is simpler to implement and generates more compact bytecode, but register-based can be faster to interpret. The JIT compiler ultimately converts stack operations to register operations for the real CPU.

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

```text
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

Disassemble the object's class, `Calculator$`, with `javap -c`:

```text
public int multiply(int, int);
  Code:
     0: iload_1
     1: iload_2
     2: imul
     3: ireturn
```

**The same instructions.** The only difference is that a Scala `object` method is an *instance* method on the singleton `Calculator$` (so slot 0 holds `this` and the parameters start at slot 1). Scala also emits a static forwarder `Calculator.multiply` so Java code can call it like a static method. The JVM cannot tell which language produced the arithmetic.

## Anatomy of a Class File

Bytecode lives inside `.class` files, which have a strict binary layout:

```text
┌────────────────────────────┐
│ magic          0xCAFEBABE  │  4 bytes
│ minor_version              │  2 bytes
│ major_version              │  2 bytes (69 = Java 25)
├────────────────────────────┤
│ constant_pool[]            │  names, strings, numbers, refs
├────────────────────────────┤
│ access_flags               │  public, final, interface...
│ this_class, super_class    │  indices into the pool
│ interfaces[]               │
│ fields[]                   │
│ methods[]                  │  each with a Code attribute
│ attributes[]               │  SourceFile, Record, ...
└────────────────────────────┘
```

The **major version** tells the JVM which Java release the file targets. A JVM refuses class files newer than itself (`UnsupportedClassVersionError`), which is why `--release` matters when you compile a library:

| Java release  | Major version |
| ------------- | ------------- |
| Java 8        | 52            |
| Java 11       | 55            |
| Java 17       | 61            |
| Java 21       | 65            |
| Java 25 (LTS) | 69            |
| Java 26       | 70            |
| Java 27       | 71            |

The rule of thumb: **major version = Java release + 44**. Class files that use preview features set the minor version to `65535`, and only run on that exact release with `--enable-preview`.

```bash
javap -v Calculator.class | grep major
#  major version: 69
```

## Bytecode Instruction Categories

Let's tour the main families of instructions. You don't need to memorize these — just get a feel for what's available. ([Appendix B](../appendices/b-bytecode-reference.md) has a longer reference.)

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

```text
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

| Instruction               | Meaning                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `new`                     | Allocate memory for a new object (doesn't call constructor yet!)  |
| `invokespecial`           | Call a constructor (`<init>`) or a `super` method                 |
| `getfield` / `putfield`   | Access/set instance fields                                        |
| `getstatic` / `putstatic` | Access/set static fields                                          |
| `instanceof`              | Check if an object is an instance of a class                      |
| `checkcast`               | Cast an object to a type (throws `ClassCastException` on failure) |

Creating a new object is actually a two-step process:

```java
new ArrayList()
```

Bytecode:

```text
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
Math.max(1, 2)  // invokestatic — no instance, no dispatch
```

No dispatch needed — once the reference is resolved, there's exactly one possible target.

### `invokespecial` — Constructors and super calls

```java
super.toString()  // invokespecial — don't do virtual dispatch, go directly to super
```

Bypasses virtual dispatch. Used when you need to call a *specific* method (not the overridden version): constructors and `super.` calls.

> [!NOTE]
> Older books say private methods are called with `invokespecial`. That was true until Java 11. Since nestmates (JEP 181), `javac` calls private instance methods with `invokevirtual`, so that inner and outer classes can call each other's private methods directly, without the synthetic `access$000` bridges of old. The JVM still knows a private method can't be overridden and calls it directly.

### `invokedynamic` — The Game Changer

Added in Java 7, this is the most fascinating bytecode instruction. Unlike the other four, it doesn't name a target method at all. Instead, the first time it runs, the JVM calls a **bootstrap method** that returns a `CallSite` — essentially a function pointer that the JVM then calls directly on subsequent invocations.

```text
┌───────────────┐         ┌───────────┐               ┌──────────────────┐
│ Your bytecode │         │    JVM    │               │ Bootstrap method │
└───────┬───────┘         └─────┬─────┘               └─────────┬────────┘
        │ invokedynamic,        │                               │
        │ first execution       │                               │
        │──────────────────────▶│                               │
        │                       │                               │
        │                       │ link this call site           │
        │                       │──────────────────────────────▶│
        │                       │                               │
        │                       │ CallSite with a target        │
        │                       │ MethodHandle                  │
        │                       │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│
        │                       │                               │
        │                       │──╮                            │
        │                       │  │ call the target            │
        │                       │◀─╯                            │
        │                       │                               │
        │ later executions      │                               │
        │──────────────────────▶│                               │
        │                       │                               │
        │                       │──╮                            │
        │                       │  │ call the target directly,  │
        │                       │  │ JIT can inline it          │
        │                       │◀─╯                            │
        │                       │                               │
```

**Why does this matter?**

Before `invokedynamic`, every call site had to name a concrete method in a concrete class at compile time. Lambdas, closures, and dynamic languages didn't fit this model well. `invokedynamic` lets a library decide *at the first call* how to handle the invocation, and then the JVM optimizes it just as aggressively as any other call.

**Java lambdas use it:**

```java
Runnable r = () -> System.out.println("Hello");
```

Bytecode:

```text
0: invokedynamic #36,  0     // InvokeDynamic #3:run:()Ljava/lang/Runnable;
```

The lambda body itself is compiled to a private method (`lambda$main$0`), and the bootstrap method (`LambdaMetafactory`) spins up a small hidden class implementing `Runnable` that calls it — no anonymous inner class file needed.

**Scala lambdas use it too** (since Scala 2.12):

```scala
val f: Int => Int = x => x + 1
```

Before Scala 2.12, this created an anonymous class for every lambda. Since 2.12 (and in Scala 3), Scala emits `invokedynamic` with `LambdaMetafactory` just like Java, making lambdas much cheaper and your JARs much smaller.

**And a lot more of modern Java compiles to it**, because it lets the JDK improve the implementation without recompiling your code:

| Java source                           | Bootstrap                     | Since   |
| ------------------------------------- | ----------------------------- | ------- |
| Lambdas, method references            | `LambdaMetafactory`           | Java 8  |
| String concatenation `"a" + b`        | `StringConcatFactory`         | Java 9  |
| Record `toString`/`equals`/`hashCode` | `ObjectMethods`               | Java 16 |
| Pattern `switch`                      | `SwitchBootstraps.typeSwitch` | Java 21 |

```text
// "Hello " + name + " #" + n
2: invokedynamic #33,  0     // InvokeDynamic #2:makeConcatWithConstants:(Ljava/lang/String;I)Ljava/lang/String;
```

> **Fun fact**: `invokedynamic` was originally designed (JSR 292) for JRuby and other dynamic languages on the JVM. Its adoption for Java/Scala lambdas was a brilliant repurposing that nobody initially planned.

### Dynamic Constants (`condy`)

Java 11 applied the same trick to constants. A `CONSTANT_Dynamic` constant-pool entry (JEP 309, nicknamed **condy**) is computed by a bootstrap method the first time `ldc` loads it, then cached forever as a true constant. It's mostly used by compilers and bytecode tools (code-coverage tools such as JaCoCo use it, for example) to create complex constants lazily without a static initializer.

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
- A companion object (`Point$`) with `apply()` (factory) and `unapply()` (pattern matching extractor)
- `Serializable` and `Product` interface implementations

```bash
# See all the generated methods
javap -p Point.class
```

Output (abridged):

```text
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

Java's `record` generates a much smaller class: fields, accessors, and a constructor, while `toString`/`equals`/`hashCode` are one-line `invokedynamic` calls to `ObjectMethods` (see the table above). No `copy`, no `Product`, no `unapply`.

### Traits

Scala traits compile differently depending on the Scala version:

**Scala 2.12+ and Scala 3**: A trait with concrete methods compiles to a Java interface with `default` methods:

```scala
trait Greeter:
  def greet(name: String): String = s"Hello, $name!"
```

Becomes:

```text
public interface Greeter {
  public static java.lang.String greet$(Greeter, java.lang.String);
  public default java.lang.String greet(java.lang.String);
}
```

(The static `greet$` helper lets classes that mix in the trait call the implementation directly.)

**Before Scala 2.12**: Concrete methods lived in a separate static class (`Greeter$class`), and implementing classes got static forwarder methods. This was more complex and slower.

### Pattern Matching

```scala
def describe(x: Any): String = x match
  case i: Int if i > 0 => "positive int"
  case s: String       => s"string: $s"
  case _               => "something else"
```

This compiles to a chain of `instanceof` checks and conditional branches — essentially a series of `if/else if` blocks (Scala 3 output, truncated):

```text
 0: aload_1
 1: astore_2
 2: aload_2
 3: instanceof    #35  // class java/lang/Integer
 6: ifeq          26   // not an Int? try the next case
 9: aload_2
10: invokestatic  #41  // scala/runtime/BoxesRunTime.unboxToInt
13: istore_3
14: iload_3
15: istore        4
17: iload         4
19: iconst_0
20: if_icmple     26   // guard i > 0 failed? try the next case
23: ldc           #43  // String positive int
25: areturn
...
```

Java's pattern `switch` (Java 21) takes a different route: the whole type test is one `invokedynamic` to `SwitchBootstraps.typeSwitch`, which returns the index of the matching case, followed by a plain `tableswitch`:

```text
11: invokedynamic #13,  0    // InvokeDynamic #0:typeSwitch:(Ljava/lang/Object;I)I
```

## The Constant Pool

Every `.class` file has a **constant pool** — a table of all the constants, class names, method names, field names, and type descriptors used in the class. Bytecode instructions reference the constant pool by index.

```bash
javap -v Calculator.class  # -v for verbose, includes constant pool
```

```text
Constant pool:
   #1 = Methodref    #2.#3     // java/lang/Object."<init>":()V
   #2 = Class        #4        // java/lang/Object
   #3 = NameAndType  #5:#6     // "<init>":()V
   #4 = Utf8         java/lang/Object
   ...
```

When bytecode says `invokevirtual #7`, it means "look up entry #7 in the constant pool to find which method to call." At run time, resolution (see [Chapter 4](04-class-loaders.md#4-resolution)) turns these symbolic entries into direct pointers.

## Reading and Generating Bytecode: the Class-File API

For twenty years, the standard way to read or generate bytecode from Java code was a third-party library, mostly **ASM** (and higher-level ones built on top of it, like ByteBuddy and cglib). The JDK itself embedded a private copy of ASM for lambdas, proxies, and tools.

That had a structural problem: every six months a new class-file version arrives, and ASM can only support it *after* the release. Frameworks that bundled an older ASM broke on the new JDK ("Unsupported class file major version 69" is a message many Gradle and Spring users have met).

Since **Java 24**, the JDK has a standard API for this: **`java.lang.classfile`** <span class="since">Java 24</span> (JEP 484, previewed in 22 and 23). It always supports exactly the class-file format of the JDK it ships with, and the JDK has been migrating its own internals from ASM to it.

Here's the `Calculator.multiply` method from earlier, generated from scratch and then read back:

```java
import java.lang.classfile.ClassFile;
import java.lang.constant.ClassDesc;
import java.lang.constant.MethodTypeDesc;
import java.nio.file.Files;
import java.nio.file.Path;

import static java.lang.constant.ConstantDescs.CD_int;

void main() throws Exception {
    // Generate: public class Calculator { public static int multiply(int, int) }
    byte[] bytes = ClassFile.of().build(ClassDesc.of("Calculator"), clb ->
        clb.withFlags(ClassFile.ACC_PUBLIC)
           .withMethodBody("multiply",
                MethodTypeDesc.of(CD_int, CD_int, CD_int),
                ClassFile.ACC_PUBLIC | ClassFile.ACC_STATIC,
                code -> code.iload(0).iload(1).imul().ireturn()));
    Files.write(Path.of("Calculator.class"), bytes);

    // Parse it back and list the methods
    var model = ClassFile.of().parse(bytes);
    for (var method : model.methods()) {
        IO.println(method.methodName().stringValue() + method.methodType().stringValue());
    }
    // prints: multiply(II)I
}
```

Run it with `java Gen.java`, then `javap -c Calculator.class` shows exactly the four instructions we saw earlier. The API has three sides: **parsing** into immutable models (`ClassModel`, `MethodModel`, `CodeModel`), **building** with builders and lambdas, and **transforming** (`ClassFile.transformClass(model, transform)`), which covers the classic agent use case of "copy this class but change these methods".

> [!TIP]
> You'll rarely write this API in application code. But if you maintain a Java agent, a code generator, or a Scala compiler plugin that emits bytecode, it removes the "wait for ASM to support the new JDK" step. For everyday exploration, `javap` is still your best friend.

## Bytecode Tools

Here are the tools you'll use to explore bytecode:

| Tool                  | Purpose                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `javap -c`            | Basic disassembly — show instructions                             |
| `javap -v`            | Verbose — includes constant pool, line numbers, stack map table   |
| `javap -p`            | Show private members too                                          |
| `java.lang.classfile` | Standard API to parse, generate, and transform class files (24+)  |
| ASM                   | The classic low-level bytecode library, still widely used         |
| ByteBuddy             | Higher-level runtime code generation (Mockito, Hibernate, agents) |
| CFR / Procyon         | Decompilers — go from bytecode back to Java source                |

> **Tip for Scala devs**: When debugging a mysterious runtime behavior, `javap -c -p` on the compiled class is incredibly revealing. You'll see exactly what the Scala compiler generated — including things you didn't expect (bridge methods, boxing conversions, static forwarders, `$init$` methods on traits).

## A Glimpse of Valhalla <span class="preview">Preview in 28</span>

Project Valhalla's **value classes** (JEP 401, preview in JDK 28) are the biggest change to the class-file format in years, yet they add surprisingly little new bytecode. A value class is an ordinary class file *without* the `ACC_IDENTITY` flag (which takes over the old `ACC_SUPER` bit); fields that must be set before `super()` is called are marked strict (JEP 539); and a new `LoadableDescriptors` attribute tells the JVM which value classes to load early so it can flatten them. Such class files carry a preview version (`72.65535` for JDK 28). The instructions you learned in this chapter stay the same. What changes is how the JVM is allowed to lay out and pass those objects — see [Chapter 14](../part-4-type-system/14-value-types-valhalla.md).

<div class="takeaways">

## Key Takeaways

- Bytecode is the JVM's instruction set: about 200 instructions, each identified by a one-byte opcode
- The JVM is **stack-based**: instructions push and pop from an operand stack
- A class file starts with `0xCAFEBABE` and a **major version** (Java release + 44: 69 = Java 25, 71 = Java 27)
- There are **five invoke instructions**: `invokevirtual`, `invokeinterface`, `invokestatic`, `invokespecial`, and `invokedynamic`
- **`invokedynamic`** (Java 7) powers lambdas, string concatenation, records, and pattern `switch`; **condy** (Java 11) does the same for constants
- Scala and Java produce the **same instructions** for equivalent operations; Scala generates more code per line (case classes, traits, pattern matching)
- The **Class-File API** (`java.lang.classfile`, final in Java 24) is the standard way to read, write, and transform bytecode, and always supports the current class-file version
- `javap -c` is your best friend for understanding what the compiler actually generates

</div>
