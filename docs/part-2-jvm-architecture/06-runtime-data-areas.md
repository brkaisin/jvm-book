# Chapter 6 — Runtime Data Areas (Memory Layout)

[← Previous: Bytecode](05-bytecode.md) · [Next: The Execution Engine →](07-execution-engine.md)

---

## Where Does Everything Live?

When the JVM starts, it carves out several regions of memory, each with a specific purpose. Understanding these areas is essential for debugging memory issues, tuning performance, and making sense of error messages like `OutOfMemoryError` and `StackOverflowError`.

Here's the big picture:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         JVM Process Memory                          │
│                                                                     │
│  ┌──────────────────────────────────────────┐  ┌─────────────────┐  │
│  │              HEAP                        │  │   METASPACE     │  │
│  │                                          │  │ (native memory) │  │
│  │  ┌──────────────┐  ┌──────────────────┐  │  │                 │  │
│  │  │    YOUNG     │  │       OLD        │  │  │ Class metadata  │  │
│  │  │  GENERATION  │  │   GENERATION     │  │  │ Method bytecode │  │
│  │  │              │  │                  │  │  │ Constant pools  │  │
│  │  │ ┌────┐┌────┐ │  │                  │  │  │ Field/method    │  │
│  │  │ │Eden││Surv│ │  │ Long-lived       │  │  │   descriptors   │  │
│  │  │ │    ││ivor│ │  │ objects          │  │  │                 │  │
│  │  │ └────┘└────┘ │  │                  │  │  │                 │  │
│  │  └──────────────┘  └──────────────────┘  │  └─────────────────┘  │
│  └──────────────────────────────────────────┘                       │
│                                                                     │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐   ┌───────────────┐   │
│  │  Thread 1  │ │  Thread 2  │ │  Thread 3  │   │  Native       │   │
│  │ ┌────────┐ │ │ ┌────────┐ │ │ ┌────────┐ │   │  Method       │   │
│  │ │  Stack │ │ │ │  Stack │ │ │ │  Stack │ │   │  Stacks       │   │
│  │ ├────────┤ │ │ ├────────┤ │ │ ├────────┤ │   │               │   │
│  │ │  PC    │ │ │ │  PC    │ │ │ │  PC    │ │   │  (JNI calls)  │   │
│  │ └────────┘ │ │ └────────┘ │ │ └────────┘ │   └───────────────┘   │
│  └────────────┘ └────────────┘ └────────────┘                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Let's explore each area.

## The Heap — Where Objects Live

The heap is the largest memory area and the one you'll interact with most. **Every object** you create lives here — whether you write `new ArrayList()` in Java, create a `case class` instance in Scala, or allocate a closure.

```scala
val person = Person("Alice", 30)   // This Person object lives on the heap
val names = List("a", "b", "c")    // The List and its nodes live on the heap
val f = (x: Int) => x + 1          // The closure object lives on the heap
```

The heap is shared across all threads. This is why concurrent access to objects requires synchronization.

### Generational Structure

Modern JVMs divide the heap into **generations** based on a key empirical observation:

> **The Weak Generational Hypothesis**: Most objects die young.

Think about it. Every time you call `.map(...)` on a Scala collection, intermediate objects are created and immediately discarded. Every `String` concatenation creates a temporary. The vast majority of objects are used briefly and then become garbage.

The JVM exploits this by dividing the heap into:

#### Young Generation

Where new objects are born. It's further divided into:

- **Eden Space**: All new objects start here (with some exceptions). When Eden fills up, a **minor GC** (young generation collection) happens.

- **Survivor Spaces (S0, S1)**: Objects that survive a minor GC are copied to a survivor space. The two survivor spaces alternate roles (one is always empty). Objects bounce between them, aging with each GC cycle.

```
New object → Eden

Eden fills up → Minor GC

Surviving objects → Survivor S0 (age 1)

Next minor GC → Survivors from S0 → S1 (age 2)
                 New survivors from Eden → S1 (age 1)

After enough cycles (default: age 15) → Promoted to Old Generation
```

#### Old Generation (Tenured)

Objects that survive many young generation GC cycles get **promoted** here. This area is collected less frequently (major GC / full GC), because it contains long-lived objects that are less likely to be garbage.

Examples of long-lived objects:
- Cached data
- Singleton objects (Scala `object` instances)
- Thread-pool instances
- Database connection pools

> **Scala parallel**: Scala's immutable data structures and functional style create *lots* of short-lived objects. `list.map(f).filter(g).flatMap(h)` creates intermediate collections at each step. This is fine — the young generation GC is optimized for exactly this pattern: cheap allocation, cheap collection of short-lived objects.

### Heap Sizing

You control the heap size with these flags:

```bash
java -Xms512m -Xmx2g -jar myapp.jar
#     ^^^^     ^^^^^
#     Initial  Maximum
#     heap     heap
#     size     size
```

- `-Xms` — Initial heap size. The JVM starts with this much heap.
- `-Xmx` — Maximum heap size. The heap can grow up to this limit.

If you exceed `-Xmx`, you get `java.lang.OutOfMemoryError: Java heap space`.

> **Tip**: For production, set `-Xms` equal to `-Xmx`. This avoids the overhead of the JVM resizing the heap at runtime.

## The Method Area / Metaspace — Where Class Metadata Lives

When a class is loaded, the JVM needs to store information *about* the class: its name, its superclass, its fields, its method bytecode, its constant pool, its annotations. This goes into the **Method Area**.

Since Java 8, the method area is implemented as **Metaspace** — which lives in **native memory** (outside the Java heap, managed by the OS).

### Before Java 8: PermGen

Before Java 8, this was the **Permanent Generation (PermGen)** — a section of the heap with a fixed size. It was a constant headache:

```
# The dreaded error, especially in app servers with hot reloading:
java.lang.OutOfMemoryError: PermGen space
```

PermGen had a fixed max size (default 64–256 MB depending on JVM version). Every class load consumed space, and class unloading was finicky. Deploy an app to Tomcat a few times and you'd run out.

### After Java 8: Metaspace

Metaspace lives in native memory and grows automatically. You can still set a limit:

```bash
java -XX:MaxMetaspaceSize=512m -jar myapp.jar
```

But by default, it grows as needed (up to available system memory). The `PermGen space` error is history.

What's stored in Metaspace:
- Class names and hierarchy
- Field and method descriptors
- Bytecode of methods
- Constant pools
- Annotation data
- Static variables (since Java 8, static variables for loaded classes are stored on the heap as part of the `java.lang.Class` mirror object, but class *metadata* is in Metaspace)

## The Stack — Per-Thread, Per-Method

Every thread has its own **JVM stack**. The stack stores **frames** — one frame for each method call in progress.

```
Thread 1's Stack:
┌──────────────────────────┐
│  Frame: main()           │  ← Currently executing
│  ┌─────────────────────┐ │
│  │ Local variables     │ │  args, local vars
│  │ Operand stack       │ │  Temp values for computation
│  │ Return address      │ │  Where to go when this method returns
│  └─────────────────────┘ │
├──────────────────────────┤
│  Frame: processData()    │  ← Called by main()
│  ┌─────────────────────┐ │
│  │ Local variables     │ │
│  │ Operand stack       │ │
│  │ Return address      │ │
│  └─────────────────────┘ │
├──────────────────────────┤
│  Frame: calculate()      │  ← Called by processData()
│  ┌─────────────────────┐ │
│  │ Local variables     │ │
│  │ Operand stack       │ │
│  │ Return address      │ │
│  └─────────────────────┘ │
└──────────────────────────┘
```

When `calculate()` returns, its frame is popped. When `processData()` returns, its frame is popped. And so on.

### What's in a Stack Frame

Each frame contains:

1. **Local Variables Array**: Stores the method's parameters and local variables. For instance methods, slot 0 is always `this`.

2. **Operand Stack**: The working area where bytecode instructions push and pop values (as we saw in [Chapter 5](05-bytecode.md)).

3. **Frame Data**: Return address, reference to the constant pool, exception handler information.

### Stack Overflow

The stack has a fixed size per thread (default: usually 512 KB to 1 MB, depending on the platform). When you make too many nested method calls, the stack runs out of space:

```scala
def recurse(n: Int): Int = recurse(n + 1)  // Never terminates

recurse(0)  // java.lang.StackOverflowError!
```

Each call to `recurse` adds a frame to the stack. After roughly 10,000–50,000 calls (depending on frame size and stack size), it overflows.

You can increase the stack size:

```bash
java -Xss4m -jar myapp.jar   # 4 MB per thread
```

But the real fix is usually to avoid deep recursion — or use tail recursion.

> **Scala's `@tailrec`**: Scala can optimize tail-recursive methods into loops at compile time:
>
> ```scala
> import scala.annotation.tailrec
>
> @tailrec
> def sum(n: Int, acc: Int = 0): Int =
>   if n <= 0 then acc
>   else sum(n - 1, acc + n)  // Tail position — compiled to a loop!
>
> sum(1_000_000)  // Works fine, no stack overflow
> ```
>
> The `@tailrec` annotation is a safety net: the compiler will **error** if the method isn't actually in tail position. Without it, you might *think* it's tail-recursive when it's not.
>
> At the bytecode level, a `@tailrec` method compiles to a `goto` that jumps back to the beginning of the method — no new frames are created. It's literally a while loop.

### Stack Memory is Not Garbage Collected

Unlike the heap, the stack is managed by a simple pointer. When a method returns, the stack pointer moves back — the frame is "freed" instantly. No GC needed. This is why stack allocation is essentially free.

## The PC Register — Where Am I?

Each thread has a tiny **Program Counter (PC) register** that holds the address of the bytecode instruction currently being executed. If the thread is executing a native method (JNI), the PC is undefined.

You'll almost never think about the PC register directly, but it's what lets the JVM know where each thread is in its execution.

## The Native Method Stack

When your code calls a native method (via JNI — Java Native Interface), the JVM uses a separate native method stack. Native methods are written in C/C++ and don't use bytecode, so they can't use the JVM stack.

```java
// This native method uses the native method stack
public native int nativeHash(Object obj);
```

Most applications rarely use native methods directly. But they're used internally by the JVM (e.g., I/O operations, threading primitives) and by libraries that interface with the OS.

## Direct Memory (Off-Heap)

There's one more area that's not part of the classic JVM data areas but is important in practice: **direct memory** (also called off-heap memory).

You can allocate memory outside the heap using `ByteBuffer.allocateDirect()` or the newer Foreign Memory API (Java 22+):

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);  // 1 MB off-heap
```

This memory is:
- Allocated in native memory (not part of the heap)
- Not tracked by the garbage collector (you manage it)
- Used for I/O operations (avoids copying between JVM heap and OS buffers)
- Capped by `-XX:MaxDirectMemorySize`

> **Scala connection**: Libraries like Netty (used by Play Framework, Akka HTTP) and Apache Arrow (used by Spark) use direct memory extensively for high-performance I/O and columnar data processing.

## Putting It All Together: Memory of a Running Scala App

Let's trace what happens when this Scala program runs:

```scala
object App:
  def main(args: Array[String]): Unit =
    val people = List(
      Person("Alice", 30),
      Person("Bob", 25)
    )
    val names = people.map(_.name)
    println(names)

case class Person(name: String, age: Int)
```

Here's where everything ends up:

| Item                                   | Memory Area                                     |
| -------------------------------------- | ----------------------------------------------- |
| `App` class metadata (methods, fields) | Metaspace                                       |
| `Person` class metadata                | Metaspace                                       |
| `App$` singleton instance              | Heap (Old Gen — lives forever)                  |
| `args` array                           | Heap (Young Gen)                                |
| `Person("Alice", 30)` object           | Heap (Young Gen)                                |
| `Person("Bob", 25)` object             | Heap (Young Gen)                                |
| The `List` and its nodes               | Heap (Young Gen)                                |
| `names` list (result of `.map`)        | Heap (Young Gen)                                |
| The lambda `_.name`                    | Either inlined by the JIT or a tiny heap object |
| `main` method's stack frame            | Stack (Thread 1)                                |
| Local variables (`people`, `names`)    | Stack frame's local variable array              |
| PC register (current instruction)      | PC Register (Thread 1)                          |

After `main` returns, all the heap objects become unreachable and will be collected by the next GC.

## Key Takeaways

- **Heap**: Where all objects live. Split into Young (Eden + Survivor) and Old generations. Shared across threads.
- **Metaspace**: Where class metadata lives. Native memory since Java 8 (replaced PermGen).
- **Stack**: Per-thread, stores method call frames. Fixed size. `StackOverflowError` means too many nested calls.
- **PC Register**: Per-thread, tracks current instruction.
- **Native Method Stack**: For JNI calls to C/C++ code.
- The **Weak Generational Hypothesis** (most objects die young) drives the generational heap design.
- Scala's `@tailrec` compiles recursion into a loop, avoiding stack overflow.
- Functional Scala code creates many short-lived objects, which is *exactly* what the young generation is optimized for.

---

[← Previous: Bytecode](05-bytecode.md) · [Next: The Execution Engine →](07-execution-engine.md)
