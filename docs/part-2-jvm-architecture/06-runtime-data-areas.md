# Chapter 6 — Runtime Data Areas (Memory Layout)

## Where Does Everything Live?

When the JVM starts, it carves out several regions of memory, each with a specific purpose. Understanding these areas is essential for debugging memory issues, tuning performance, and making sense of error messages like `OutOfMemoryError` and `StackOverflowError`.

Figure 6.1 shows the big picture.

<figure class="fig">
{{#include ../figures/06-memory-map.svg}}
<figcaption><b>Figure 6.1.</b> One heap, Metaspace and code cache are shared by every thread, while each thread gets its own stack and PC register; only the heap (blue) holds garbage-collected objects.</figcaption>
</figure>

The JVM specification describes these areas abstractly (heap, method area, JVM stacks, PC registers, native method stacks). What follows is how HotSpot, the JVM you almost certainly run, implements them. Let's explore each area.

## The Heap — Where Objects Live

The heap is the largest memory area and the one you'll interact with most. **Every object** you create lives here — whether you write `new ArrayList()` in Java, create a `case class` instance in Scala, or allocate a closure.

```scala
val person = Person("Alice", 30)   // This Person object lives on the heap
val names = List("a", "b", "c")    // The List and its nodes live on the heap
val f = (x: Int) => x + 1          // The closure object lives on the heap
```

The heap is shared across all threads. This is why concurrent access to objects requires synchronization.

Every object on the heap starts with a small **header** that the JVM uses for housekeeping (class, identity hash code, GC age, lock state). On a 64-bit JVM that header is 12 bytes in the classic layout, and just **8 bytes with compact object headers**, which became the default in Java 27 (JEP 534). For a heap full of small objects, that's a noticeable saving. [Chapter 8](../part-3-memory-and-gc/08-object-layout.md) takes objects apart byte by byte.

### Generational Structure

Modern JVMs divide the heap into **generations** based on a key empirical observation:

> **The Weak Generational Hypothesis**: Most objects die young.

Think about it. Every time you call `.map(...)` on a Scala collection, intermediate objects are created and immediately discarded. Every `String` concatenation creates a temporary. The vast majority of objects are used briefly and then become garbage.

The JVM exploits this by dividing the heap into:

#### Young Generation

Where new objects are born. It's further divided into:

- **Eden Space**: All new objects start here (with some exceptions, such as very large arrays). When Eden fills up, a **minor GC** (young generation collection) happens.

- **Survivor Spaces (S0, S1)**: Objects that survive a minor GC are copied to a survivor space. The two survivor spaces alternate roles (one is always empty). Objects bounce between them, aging with each GC cycle.

```text
New object → Eden

Eden fills up → Minor GC

Surviving objects → Survivor S0 (age 1)

Next minor GC → Survivors from S0 → S1 (age 2)
                 New survivors from Eden → S1 (age 1)

After enough cycles (at most age 15) → Promoted to Old Generation
```

#### Old Generation (Tenured)

Objects that survive many young generation GC cycles get **promoted** here. This area is collected less frequently, because it contains long-lived objects that are less likely to be garbage.

Examples of long-lived objects:
- Cached data
- Singleton objects (Scala `object` instances)
- Thread-pool instances
- Database connection pools

> [!NOTE]
> The picture above, with Eden, survivors, and old generation as neat contiguous blocks, is how the classic Serial and Parallel collectors lay out memory. **G1**, the default collector (on every machine since Java 27), splits the heap into many equal-sized **regions**, and "young" and "old" are just labels on sets of regions that can change over time. ZGC and Shenandoah are generational too nowadays. The *idea* of generations is the same everywhere. Part III covers the collectors in detail, starting with [Chapter 9](../part-3-memory-and-gc/09-gc-fundamentals.md).

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

Without `-Xmx`, the JVM picks a maximum of **25% of the available RAM**, and it's container-aware: inside a container with a 2 GB limit, "available RAM" means 2 GB, not the host's memory. In containers, `-XX:MaxRAMPercentage=75` is a popular way to say "use most of whatever memory limit I'm given".

If you exceed the maximum, you get `java.lang.OutOfMemoryError: Java heap space`.

> [!TIP]
> For production servers, setting `-Xms` equal to `-Xmx` avoids the cost of resizing the heap at runtime and makes memory usage predictable.

## The Method Area / Metaspace — Where Class Metadata Lives

When a class is loaded, the JVM needs to store information *about* the class: its name, its superclass, its fields, its method bytecode, its constant pool, its annotations. This goes into the **Method Area**.

Since Java 8, HotSpot implements the method area as **Metaspace** — which lives in **native memory** (outside the Java heap).

### Before Java 8: PermGen

Before Java 8, this was the **Permanent Generation (PermGen)** — a section of the heap with a fixed size. It was a constant headache:

```text
# The dreaded error, especially in app servers with hot reloading:
java.lang.OutOfMemoryError: PermGen space
```

PermGen had a fixed max size (default 64–256 MB depending on JVM version). Every class load consumed space, and class unloading was finicky. Deploy an app to Tomcat a few times and you'd run out.

### After Java 8: Metaspace

Metaspace lives in native memory and grows automatically. You can still set a limit:

```bash
java -XX:MaxMetaspaceSize=512m -jar myapp.jar
```

But by default, it grows as needed (up to available system memory). The `PermGen space` error is history; a class loader leak now shows up as `OutOfMemoryError: Metaspace` instead, or simply as a process that keeps growing.

What's stored in Metaspace:
- Class structures (HotSpot calls them `Klass`): names, hierarchy, vtables
- Field and method descriptors
- Bytecode of methods
- Constant pools
- Annotation data

What's *not* stored there, despite what older articles say: **static fields** and **interned strings**. Both live on the regular heap (static fields as part of the class's `java.lang.Class` mirror object).

Two details worth knowing:

- **Compressed class space.** Objects point to their class with a compact pointer rather than a full 64-bit address. For that to work, class structures live in a dedicated part of Metaspace called the *compressed class space* (1 GB reserved by default, `-XX:CompressedClassSpaceSize`). With compact object headers, this pointer shrinks even further, to a 22-bit class index (see [Chapter 8](../part-3-memory-and-gc/08-object-layout.md)).
- **Shared archives.** When the JVM starts with a CDS archive or an AOT cache (see [Chapter 4](04-class-loaders.md#skipping-the-work-cds-and-the-aot-cache)), pre-built class metadata is memory-mapped from the file, and can even be shared between several JVM processes on the same machine.

## The Code Cache — Where Compiled Code Lives

When the JIT compiler (see [Chapter 7](07-execution-engine.md)) turns a hot method into native machine code, that code has to live somewhere executable. That's the **code cache**, another native memory area. It also holds the interpreter itself and small generated helper routines ("stubs").

Since Java 9 (JEP 197) the code cache is **segmented** into three parts, so that code with different lifetimes doesn't fragment each other:

| Segment      | Contains                                                  |
| ------------ | --------------------------------------------------------- |
| Non-method   | Interpreter, stubs, other JVM-internal code               |
| Profiled     | C1-compiled code with profiling, usually short-lived      |
| Non-profiled | Fully optimized code (C2, trivial C1), usually long-lived |

The total size is capped by `-XX:ReservedCodeCacheSize` (240 MB by default with tiered compilation). That's plenty for most apps, but very large ones can fill it, and the JVM then prints `CodeCache is full. Compiler has been disabled.` — from then on, new hot code stays interpreted, and performance quietly degrades. You can check usage with:

```bash
jcmd <pid> Compiler.codecache
```

## The Stack — Per-Thread, Per-Method

Every thread has its own **JVM stack**. The stack stores **frames** — one frame for each method call in progress. The most recent call is on top, as Figure 6.2 shows.

<figure class="fig">
{{#include ../figures/06-stack-frame.svg}}
<figcaption><b>Figure 6.2.</b> Frames pile up as calls nest, and each frame holds a local variable array, an operand stack and frame data.</figcaption>
</figure>

When `calculate()` returns, its frame is popped. When `processData()` returns, its frame is popped. And so on.

### What's in a Stack Frame

Each frame contains:

1. **Local Variables Array**: Stores the method's parameters and local variables. For instance methods, slot 0 is always `this`. Primitives are stored directly; for objects, the slot holds a *reference*, while the object itself is on the heap.

2. **Operand Stack**: The working area where bytecode instructions push and pop values (as we saw in [Chapter 5](05-bytecode.md)).

3. **Frame Data**: Return address, a reference to the class's constant pool, and what's needed to unwind the frame when an exception is thrown.

The sizes of the local variable array and operand stack are computed by the compiler and stored in the class file, so the JVM knows exactly how big each frame is before calling the method. (Once a method is JIT-compiled, its frame is laid out by the compiler instead, with values kept in CPU registers where possible.)

### Stack Overflow

The stack has a fixed maximum size per thread (default: 1 MB on Linux x64, 2 MB on macOS on Apple silicon). When you make too many nested method calls, the stack runs out of space:

```scala
def recurse(n: Int): Int = recurse(n + 1)  // Never terminates

recurse(0)  // java.lang.StackOverflowError!
```

Each call to `recurse` adds a frame to the stack. After roughly 10,000–50,000 calls (depending on frame size and stack size), it overflows.

You can increase the stack size:

```bash
java -Xss4m -jar myapp.jar   # 4 MB per platform thread
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

### And Virtual Threads?

Everything above describes **platform threads**, which map one-to-one to OS threads and get a fixed-size stack each. **Virtual threads** (final since Java 21) work differently: while a virtual thread runs, its frames sit on the stack of the platform "carrier" thread executing it. When it blocks, the JVM copies its frames into ordinary objects on the **heap** (stack chunks), freeing the carrier for other work. That's how you can have a million virtual threads without a million megabyte-sized stacks, and it means virtual thread stacks *are* managed by the GC. [Chapter 18](../part-5-concurrency/18-virtual-threads.md) tells the whole story.

## The PC Register — Where Am I?

Each thread has a tiny **Program Counter (PC) register** that holds the address of the bytecode instruction currently being executed. If the thread is executing a native method (JNI), the PC is undefined.

You'll almost never think about the PC register directly, but it's what lets the JVM know where each thread is in its execution.

## The Native Method Stack

When your code calls a native method (via JNI — Java Native Interface — or the newer FFM API), that C/C++ code needs a stack too. The JVM specification calls this the **native method stack**. In HotSpot, there's no separate area: Java frames and native frames simply share the same thread stack.

```java
// Calling this pushes a native (C) frame onto the thread's stack
public native int nativeHash(Object obj);
```

Most applications rarely use native methods directly. But they're used internally by the JDK (e.g., I/O operations, threading primitives) and by libraries that interface with the OS.

> [!NOTE]
> As part of the JDK's "integrity by default" effort, loading native code through JNI has printed a warning since Java 24 (JEP 472), unless you allow it explicitly with `--enable-native-access=ALL-UNNAMED` (or a list of modules). See [Chapter 24](../part-7-ecosystem/24-native-interop.md).

## Direct Memory (Off-Heap)

There's one more area that's not part of the classic JVM data areas but is important in practice: **direct memory** (also called off-heap memory).

You can allocate memory outside the heap with NIO's `ByteBuffer.allocateDirect()`, or with the **Foreign Function & Memory API** (final since Java 22):

```java
// NIO: freed some time after the ByteBuffer object itself is garbage collected
ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);  // 1 MB off-heap

// FFM: freed deterministically when the arena is closed
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(1024 * 1024);
    segment.set(ValueLayout.JAVA_INT, 0, 42);
}  // memory released here
```

This memory is:
- Allocated in native memory (not part of the heap)
- Not moved or scanned by the garbage collector
- Used for I/O operations (avoids copying between JVM heap and OS buffers)
- For direct `ByteBuffer`s, capped by `-XX:MaxDirectMemorySize`

> **Scala connection**: Libraries like Netty (used by Play Framework, Akka/Pekko HTTP) and Apache Arrow (used by Spark) use direct memory extensively for high-performance I/O and columnar data processing.

> [!TIP]
> Your container's memory limit must cover much more than `-Xmx`: Metaspace, code cache, thread stacks, direct memory, and the GC's own bookkeeping all live outside the heap. To see where native memory goes, start the JVM with `-XX:NativeMemoryTracking=summary` and run `jcmd <pid> VM.native_memory summary`.

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

| Item                                   | Memory Area                                            |
| -------------------------------------- | ------------------------------------------------------ |
| `App` class metadata (methods, fields) | Metaspace                                              |
| `Person` class metadata                | Metaspace                                              |
| `App$` singleton instance              | Heap (long-lived; old gen if it survives enough GCs)   |
| `args` array                           | Heap (Young Gen)                                       |
| `Person("Alice", 30)` object           | Heap (Young Gen)                                       |
| `Person("Bob", 25)` object             | Heap (Young Gen)                                       |
| The `List` and its nodes               | Heap (Young Gen)                                       |
| `names` list (result of `.map`)        | Heap (Young Gen)                                       |
| The lambda `_.name`                    | Either optimized away by the JIT or a tiny heap object |
| Native code for hot methods            | Code cache (only if they get JIT-compiled)             |
| `main` method's stack frame            | Stack (main thread)                                    |
| Local variables (`people`, `names`)    | References in the frame's local variable array         |
| PC register (current instruction)      | PC Register (main thread)                              |

After `main` returns, all the heap objects become unreachable and will be collected by the next GC.

<div class="takeaways">

## Key Takeaways

- **Heap**: Where all objects live, shared across threads. Divided into young (Eden + survivors) and old generations — as fixed areas or, with G1, as labelled regions. Each object carries a header: 8 bytes by default since Java 27.
- **Metaspace**: Where class metadata lives. Native memory since Java 8 (replaced PermGen). Static fields and interned strings are on the heap, not here.
- **Code cache**: Native memory for JIT-compiled code, segmented since Java 9. If it fills up, the JIT stops compiling.
- **Stack**: Per-thread, stores method call frames. Fixed size for platform threads; `StackOverflowError` means too many nested calls. Virtual thread stacks move to the heap when they block.
- **PC Register**: Per-thread, tracks the current bytecode instruction.
- **Native code** (JNI, FFM) runs on the same thread stack in HotSpot; off-heap memory comes from direct buffers or FFM arenas.
- The **Weak Generational Hypothesis** (most objects die young) drives the generational heap design.
- Scala's `@tailrec` compiles recursion into a loop, avoiding stack overflow.
- Functional Scala code creates many short-lived objects, which is *exactly* what the young generation is optimized for.

</div>
