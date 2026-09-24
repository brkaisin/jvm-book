# Chapter 2 — From Source Code to Execution

## The Journey of Your Code

Every time you run a Scala or Java program, your source code goes through a remarkable transformation — from human-readable text to electrical signals flipping transistors. Let's trace that journey step by step.

```text
          ┌───────────────────────────────────────┐
          │              Source code              │
          │             .scala / .java            │
          └───────────────────┬───────────────────┘
                              ▼
          ┌───────────────────────────────────────┐
          │        Compiler: scalac / javac       │
          │              compile time             │
          └───────────────────┬───────────────────┘
                              ▼
          ┌───────────────────────────────────────┐
          │                Bytecode               │
          │    .class files, packaged in a .jar   │
          └───────────────────┬───────────────────┘
    ┌─ JVM (runtime) ─────────┼─────────────────────────┐
    │                         ▼                         │
    │         ┌───────────────────────────────┐         │
    │         │          Class loader         │         │
    │         └───────────────┬───────────────┘         │
    │                         ▼                         │
    │         ┌───────────────────────────────┐         │
    │         │       Bytecode verifier       │         │
    │         └───────────────┬───────────────┘         │
    │                         ▼                         │
    │         ┌───────────────────────────────┐         │
    │         │        Execution engine       │         │
    │         │   interpreter + JIT compiler  │         │
    │         └───────────────┬───────────────┘         │
    │                         │                         │
    └─────────────────────────┼─────────────────────────┘
                              ▼
          ┌───────────────────────────────────────┐
          │          Native machine code          │
          │            runs on the CPU            │
          └───────────────────────────────────────┘
```

## Step 1: Compilation — Source to Bytecode

### Java Compilation

Let's start with a simple Java program:

```java
// Hello.java
public class Hello {
    public static void main(String[] args) {
        System.out.println("Hello from Java!");
    }
}
```

Compile it:

```bash
javac Hello.java
```

This produces `Hello.class` — a binary file containing bytecode.

> [!TIP]
> Modern Java lets you skip most of the ceremony. Since Java 25, a *compact source file* can be just a method; the class around it is implied, and the `java.base` module is imported for you:
>
> ```java
> // Hello.java (Java 25+)
> void main() {
>     IO.println("Hello from Java!");
> }
> ```
>
> And you don't even need an explicit `javac` step to try it: `java Hello.java` compiles in memory and runs (since Java 11). Since Java 22, the launched file can use other `.java` files in the same directory, which are compiled on demand. Under the hood nothing changes: `javac` still produces an ordinary class with ordinary bytecode.

### Scala Compilation

Now the same thing in Scala:

```scala
// Hello.scala
@main def hello(): Unit =
  println("Hello from Scala!")
```

Compile it:

```bash
scalac Hello.scala
```

(Or run it directly with `scala run Hello.scala`: since Scala 3.5, the `scala` command *is* Scala CLI, which compiles and runs in one go, a bit like `java Hello.java`.)

`scalac` produces *multiple* `.class` files (Scala tends to generate more classes than Java because of top-level definitions, companion objects, closures, and other features). But they're in the same format.

### What's in a `.class` File?

A `.class` file is a binary file with a precise structure. You can peek inside with `javap`, the JDK's class file disassembler:

```bash
javap -c Hello.class
```

For the Java version, you'd see something like:

```text
Compiled from "Hello.java"
public class Hello {
  public static void main(java.lang.String[]);
    Code:
       0: getstatic     #7    // Field java/lang/System.out:Ljava/io/PrintStream;
       3: ldc           #13   // String Hello from Java!
       5: invokevirtual #15   // Method java/io/PrintStream.println:(Ljava/lang/String;)V
       8: return
}
```

Don't worry about understanding every instruction yet (that's [Chapter 5](../part-2-jvm-architecture/05-bytecode.md)). The point is: **this is what the JVM actually sees**. Not your nice Java or Scala syntax — these stack-based instructions.

> **Try it yourself**: Compile a simple Scala case class and run `javap -c` on it. You'll be surprised how much bytecode a single `case class Person(name: String, age: Int)` generates — `equals`, `hashCode`, `toString`, `copy`, `apply`, `unapply`...

## Step 2: Packaging — JARs Are Just ZIP Files

Before your code reaches the JVM, it's usually packaged into a **JAR** (Java ARchive). A JAR is literally a ZIP file with a `.jar` extension and a specific internal structure:

```text
myapp.jar
├── META-INF/
│   └── MANIFEST.MF          (metadata: main class, version, etc.)
├── com/
│   └── example/
│       ├── Hello.class
│       └── Utils.class
└── scala/                    (Scala's standard library classes, if bundled)
```

You can prove this to yourself:

```bash
# Rename and unzip
cp myapp.jar myapp.zip
unzip myapp.zip -d myapp-contents/

# Or just use jar:
jar tf myapp.jar    # list contents
```

In Scala, sbt's `package` task creates a JAR. `sbt-assembly` creates a "fat JAR" that bundles all dependencies — so you get a single file you can run with `java -jar`.

## Step 3: Class Loading — Lazy by Design

When the JVM starts, it does **not** load all your classes at once. It loads them *on demand* — the first time a class is actually needed. This is called **lazy loading**.

Here's the sequence:

```text
                      ┌─ Linking ──────────┐
┌─────────────────┐   │ ┌────────────────┐ │   ┌─────────────────┐
│     Loading     │   │ │  Verification  │ │   │  Initialization │
│ read the bytes, │──▶│ └────────┬───────┘ │──▶│ run static init │
│  create a Class │   │          ▼         │   └─────────────────┘
└─────────────────┘   │ ┌────────────────┐ │
                      │ │  Preparation   │ │
                      │ └────────┬───────┘ │
                      │          ▼         │
                      │ ┌────────────────┐ │
                      │ │   Resolution   │ │
                      │ └────────────────┘ │
                      └────────────────────┘
```

1. **Loading** — The class loader reads the `.class` file (from disk, JAR, network, or even generated at runtime) and creates a raw `Class` object
2. **Linking**
   - **Verification** — Is this valid bytecode? Does it violate any rules? (This is a safety check — you can't craft malicious bytecode that accesses memory it shouldn't)
   - **Preparation** — Allocate memory for static fields, set them to default values (`0`, `null`, `false`)
   - **Resolution** — Turn symbolic references (like class names as strings) into direct references
3. **Initialization** — Run the class's static initializer (`<clinit>`) — this is where `static {}` blocks and static field assignments execute

> **Scala parallel**: Scala `object` singletons are implemented as classes with a static initializer. When you first access `MyObject.something`, the JVM loads the class and runs the initializer — that's why Scala objects are lazily initialized.

```scala
object ExpensiveSetup:
  println("Initializing!")  // This prints only when ExpensiveSetup is first accessed
  val data = loadFromDatabase()
```

We'll explore class loading in much more detail in [Chapter 4](../part-2-jvm-architecture/04-class-loaders.md).

## Step 4: Bytecode Verification — Trust, but Verify

Before executing any bytecode, the JVM runs a **verifier** that checks:

- Stack operations are balanced (you don't pop more than you pushed)
- Local variables are initialized before use
- Method signatures match at call sites
- Type rules are respected (you can't store an `int` where an object reference is expected)
- Access modifiers are honored (`private` means private)

This verification step is what makes the JVM **safe**. Even if someone gives you a maliciously crafted `.class` file, the verifier will reject it before it runs. This was critical for Java applets (remember those? They were finally removed from the JDK in Java 26) — untrusted code running in your browser. Today it is simply what guarantees that no bytecode, whoever produced it, can corrupt the JVM's memory.

> **Why this matters for Scala**: The Scala compiler sometimes generates bytecode patterns that are unusual but valid. Occasionally, a compiler bug can produce bytecode that fails verification. When you see a `java.lang.VerifyError`, you know the JVM's verifier caught something wrong in the bytecode itself — not in your source code.

## Step 5: Execution — Interpreter + JIT

Here's where it gets interesting. The JVM has **two** ways to execute bytecode, and it uses both:

### The Interpreter

When the JVM first encounters a method, it **interprets** it — reads each bytecode instruction and executes it one by one. This is simple but slow, like reading a recipe step by step every time you cook the dish.

### The JIT Compiler (Just-In-Time)

The JVM watches which methods are called frequently. When a method is "hot" (called many times), the **JIT compiler** kicks in and compiles the bytecode to native machine code — the exact same kind of code a C compiler would produce. HotSpot actually does this in tiers: a fast compiler (C1) first, then an optimizing one (C2) for the really hot code.

```text
┌───────────────────────────────┐
│          Interpreted          │◀╌╌╌╌╌╌╌╌╌╌╌╮
│   slow, but starts instantly  │            ┆
└───────────────┬───────────────┘            ┆
                │ a few hundred calls        ┆
                ▼                            ┆
┌───────────────────────────────┐            ┆
│          C1 compiled          │            ┆
│       quick native code,      │            ┆ an assumption
│        keeps profiling        │            ┆ turns out wrong
└───────────────┬───────────────┘            ┆
                │ thousands of calls         ┆
                ▼                            ┆
┌───────────────────────────────┐            ┆
│          C2 compiled          │            ┆
│       heavily optimized       │╌╌╌╌╌╌╌╌╌╌╌╌╯
│          native code          │
└───────────────────────────────┘
```

This is why JVM applications **warm up**. They start slow (interpreting) and get faster over time (JIT-compiled code). It's also why benchmarking JVM code is tricky — you need to warm up the JIT first.

> **The beauty of this design**: The JIT compiler can make optimizations that a static compiler (like `gcc`) *cannot*. Because it watches your program run, it can optimize based on *actual behavior*:
> - "This virtual method is always called on the same class → inline it"
> - "This branch is never taken → remove the check"
> - "This object never escapes this method → don't allocate it on the heap at all, keep its fields in registers"
>
> And if one of those bets turns out wrong later, the JVM quietly *deoptimizes* back to the interpreter and tries again.

> [!TIP]
> Warm-up doesn't have to be paid on every start any more. Since Java 24, the JDK can record a *training run* into an **AOT cache** (classes already loaded and linked, and since Java 25, method profiles too) and reuse it on the next launch (Java 25+ syntax):
>
> ```bash
> java -XX:AOTCacheOutput=app.aot -cp app.jar com.example.App   # training run
> java -XX:AOTCache=app.aot -cp app.jar com.example.App          # fast start
> ```
>
> This is Project Leyden's work; [Chapter 20](../part-6-performance/20-graalvm.md) covers it, along with GraalVM Native Image.

We'll deep-dive into JIT compilation in [Chapter 7](../part-2-jvm-architecture/07-execution-engine.md) and [Chapter 19](../part-6-performance/19-jit-deep-dive.md).

## The Difference Between `scalac` and `javac`

Both compilers target the same bytecode, but they do different things:

| Aspect                | `javac`                        | `scalac`                                                          |
| --------------------- | ------------------------------ | ----------------------------------------------------------------- |
| **Input**             | Java source (`.java`)          | Scala source (`.scala`)                                           |
| **Output**            | `.class` files                 | `.class` files (same format!)                                     |
| **Type checking**     | Java's type system (simpler)   | Scala's type system (much richer: HKTs, givens, match types)      |
| **Optimizations**     | Minimal — leaves it to the JIT | Some: self-recursive tail calls become loops, `inline` (Scala 3)  |
| **Generated classes** | Roughly 1:1 with source        | Often more (module classes, closures, top-level definitions)      |
| **Speed**             | Fast                           | Slower (richer type checking = more work)                         |

The key insight: **all the rich features of Scala's type system exist only at compile time**. Once `scalac` produces bytecode, the JVM doesn't know whether it came from Scala or Java. Higher-kinded types, implicits, given instances, match types — all resolved and erased by the compiler.

## Example: Same Program, Two Languages, Same Bytecode

Let's see this in action. Here's a simple function in both languages:

**Java:**
```java
public class MathUtils {
    public static int add(int a, int b) {
        return a + b;
    }
}
```

**Scala:**
```scala
object MathUtils:
  def add(a: Int, b: Int): Int = a + b
```

Disassemble both with `javap -c`:

**Java bytecode** (`MathUtils.class`):
```text
public static int add(int, int);
  Code:
     0: iload_0
     1: iload_1
     2: iadd
     3: ireturn
```

**Scala bytecode** — a Scala `object` becomes a class named `MathUtils$` with a single instance, and the method lives there (`MathUtils$.class`):
```text
public int add(int, int);
  Code:
     0: iload_1
     1: iload_2
     2: iadd
     3: ireturn
```

**The same instructions.** The only difference is that the Scala version is an *instance* method on the singleton, so local slot 0 holds `this` and the arguments start at slot 1. `scalac` also emits a static forwarder `MathUtils.add` so Java code can call `MathUtils.add(1, 2)`; it just fetches the singleton (`MathUtils$.MODULE$`) and delegates. The JIT inlines that hop away almost immediately. Two different source languages, one runtime.

<div class="takeaways">

## Key Takeaways

- Your code goes through: **Source → Compiler → Bytecode → Class Loading → Verification → Execution**
- JAR files are just ZIP files containing `.class` files and metadata
- Class loading is **lazy** — classes are loaded only when first needed
- The bytecode verifier ensures **safety** before any code runs
- The JVM uses **both** an interpreter (for startup) and a tiered JIT compiler (for peak performance); an AOT cache can carry warm-up work across runs
- `scalac` and `javac` produce the **same bytecode format** — the JVM can't tell the difference
- All of Scala's rich type system features are **erased** at compile time

</div>
