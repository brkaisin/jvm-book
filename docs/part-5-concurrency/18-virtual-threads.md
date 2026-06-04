# Chapter 18 — Virtual Threads (Project Loom)

[← Previous: java.util.concurrent](17-juc-toolbox.md) · [Next: Part VI — Performance →](../part-6-performance/README.md)

---

## The Problem: Threads Don't Scale

Traditional JVM threads are OS threads. Each one costs ~1 MB of stack memory and involves kernel-level context switching. For 100 concurrent requests, this is fine. For 100,000? That's 100 GB of stack memory. Not happening.

But modern services need to handle many concurrent connections — most of which are waiting for I/O (database queries, HTTP calls, file reads). The threads are *idle*, just... waiting.

```
Traditional model with 10,000 connections:

Thread 1: ████░░░░░░████░░░░░░████   ← 90% waiting for I/O
Thread 2: ██░░░░░░░░░░████░░░░████   ← 90% waiting for I/O
...
Thread 10,000: ████░░░░░░░░░░████░░   ← 90% waiting for I/O

10,000 OS threads × 1 MB = 10 GB of memory, mostly doing nothing!
```

This is why reactive programming, async/await, and effect systems exist — to avoid blocking a thread while waiting for I/O. But they add complexity: callback hell, colored functions, and a different programming model.

## Virtual Threads: The Solution

**Virtual threads** (finalized in Java 21) are lightweight threads managed by the JVM, not the OS. They're cheap to create — you can have **millions** of them.

```java
// Create a virtual thread — costs ~kilobytes, not megabytes
Thread.startVirtualThread(() -> {
    var result = fetchFromDatabase();  // This BLOCKS — and that's OK!
    process(result);
});

// Or using the builder:
Thread.ofVirtual().name("worker-", 0).start(() -> {
    // ...
});
```

The key insight: **you can write blocking code and it scales**. No callbacks, no `async`/`await`, no monadic composition required.

## How Virtual Threads Work

Virtual threads are **multiplexed** onto a small pool of OS threads called **carrier threads**:

```
Virtual Threads (millions possible):
VT-1: ████▒▒▒▒▒▒████▒▒▒▒▒▒████
VT-2: ██▒▒▒▒▒▒▒▒▒▒████▒▒▒▒████
VT-3: ████▒▒▒▒▒▒▒▒▒▒████▒▒████
...
VT-100,000: ████▒▒▒▒▒▒▒▒████▒▒▒▒

████ = Running on a carrier thread
▒▒▒▒ = Parked (waiting for I/O) — NOT using a carrier thread

Carrier Threads (few, usually = CPU cores):
CT-1: [VT-1][VT-3][VT-7][VT-1][VT-42]...
CT-2: [VT-2][VT-5][VT-8][VT-3][VT-99]...
```

When a virtual thread blocks on I/O:
1. It's **unmounted** from its carrier thread (the carrier is freed)
2. The virtual thread's stack is saved (in heap memory, not in the OS stack)
3. The carrier thread picks up another virtual thread
4. When the I/O completes, the virtual thread is **remounted** onto any available carrier

This is called **parking** and **unparking**. It happens transparently — your code just sees a normal blocking call.

### Stack Chunking

Instead of a 1 MB OS stack, virtual threads have a **growable stack stored on the heap**. It starts small (~kilobytes) and grows as needed. When the virtual thread parks, the stack is preserved in heap memory.

This is why virtual threads are cheap: their "stack" is just heap objects managed by the GC.

## Example: 100,000 Virtual Threads

```java
import java.time.Duration;
import java.util.concurrent.Executors;

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (int i = 0; i < 100_000; i++) {
        executor.submit(() -> {
            Thread.sleep(Duration.ofSeconds(1));  // Simulates I/O wait
            return "done";
        });
    }
}  // Waits for all tasks to complete

System.out.println("All 100,000 tasks completed!");
```

This creates 100,000 virtual threads, each sleeping for 1 second. With platform threads, this would need 100,000 OS threads (~100 GB memory). With virtual threads, it uses a handful of carrier threads and completes in about 1 second.

## Structured Concurrency (Preview)

**Structured concurrency** ensures that concurrent tasks have a clear lifetime — they start and end within a defined scope, like structured programming for threads:

```java
// Java 21+ (preview)
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Subtask<String> user  = scope.fork(() -> fetchUser(id));
    Subtask<String> order = scope.fork(() -> fetchOrder(id));

    scope.join();            // Wait for both
    scope.throwIfFailed();   // Propagate any failures

    return new Response(user.get(), order.get());
}
// When the scope exits, all subtasks are guaranteed to be done
// If one fails, the other is cancelled
```

Benefits:
- Tasks can't "leak" — they're confined to the scope
- Failure handling is clear — if one subtask fails, others are cancelled
- Thread dumps show the parent-child relationship

## Scoped Values (Java 24)

`ThreadLocal` doesn't work well with virtual threads (millions of threads × `ThreadLocal` storage = too much memory). **Scoped values** are the replacement:

```java
static final ScopedValue<String> USER = ScopedValue.newInstance();

ScopedValue.where(USER, "alice").run(() -> {
    // This code and all code it calls can read USER
    System.out.println(USER.get());  // "alice"
    handleRequest();  // Can also read USER
});
// USER is not bound outside the scope
```

Scoped values are:
- **Immutable** within a scope (no `set()` — only `where()`)
- **Inherited** by child virtual threads/tasks
- **Lightweight** — shared by reference, not copied per thread

## What This Means for Scala

Virtual threads overlap with the problems that Scala's effect systems already solve. Here's how they compare:

### Cats Effect Fibers vs Virtual Threads

| Aspect                     | Cats Effect `IO` / Fiber    | Virtual Threads                    |
| -------------------------- | --------------------------- | ---------------------------------- |
| **Programming model**      | Monadic (for-comprehension) | Imperative (blocking)              |
| **Cancellation**           | Built-in, cooperative       | Available via `Thread.interrupt()` |
| **Error handling**         | Typed effects, `MonadError` | Try-catch                          |
| **Resource safety**        | `Resource` monad            | Try-with-resources                 |
| **Structured concurrency** | Built-in (fiber scopes)     | `StructuredTaskScope`              |
| **Thread control**         | IORuntime, custom pools     | Carrier thread pool                |
| **Composability**          | Referentially transparent   | Side-effecting                     |
| **Learning curve**         | Steep (monadic)             | Gentle (normal Java)               |

### Will Virtual Threads Replace Effect Systems?

**No**, but they change the trade-offs:

- For **simple I/O services** (CRUD, REST APIs), virtual threads let you write straightforward blocking code that scales. You might not *need* an effect system.
- For **complex concurrent logic** (racing, timeout, retry, resource management, backpressure), effect systems provide stronger guarantees and composability.
- Effect systems can **benefit from virtual threads**: Cats Effect 3.5+ and ZIO can use virtual threads as their underlying thread pool, potentially improving performance.

### Using Virtual Threads from Scala

```scala
import java.util.concurrent.Executors
import scala.concurrent.{ExecutionContext, Future}

// Create an ExecutionContext backed by virtual threads
given ExecutionContext = ExecutionContext.fromExecutor(
  Executors.newVirtualThreadPerTaskExecutor()
)

// Now every Future runs on a virtual thread
val result = Future {
  // Blocking call — each Future gets its own virtual thread
  val data = fetchFromDatabase()  // Blocks, but that's fine with virtual threads
  process(data)
}
```

With Cats Effect:

```scala
import cats.effect.*

// Cats Effect can be configured to use virtual threads for blocking operations
// The details depend on your CE version and IORuntime configuration
```

## Pinning: The Gotcha

A virtual thread gets **pinned** to its carrier thread (can't unmount) in two situations:

1. **Inside a `synchronized` block**: The carrier thread is held until the monitor is released
2. **During native method calls** (JNI)

Pinning wastes carrier threads. If all carrier threads are pinned, virtual threads can't make progress:

```java
synchronized (lock) {
    Thread.sleep(1000);  // Virtual thread pinned for 1 second!
    // Carrier thread is STUCK — can't run other virtual threads
}
```

**Fix**: Replace `synchronized` with `ReentrantLock`:

```java
ReentrantLock lock = new ReentrantLock();
lock.lock();
try {
    Thread.sleep(1000);  // Virtual thread parks cleanly
    // Carrier thread is freed to run other virtual threads
} finally {
    lock.unlock();
}
```

You can detect pinning with:
```bash
java -Djdk.tracePinnedThreads=short ...
```

> **Scala note**: Scala's `synchronized` has the same pinning issue. If you use virtual threads, prefer `java.util.concurrent.locks.ReentrantLock` for locks that guard blocking operations.

## Key Takeaways

- **Virtual threads** are lightweight (kilobytes, not megabytes), managed by the JVM, multiplexed onto carrier threads
- You can create **millions** of virtual threads — write blocking code and it scales
- Virtual threads park/unpark transparently on blocking I/O — carriers are freed
- **Structured concurrency** gives tasks a clear lifetime with automatic cancellation
- **Scoped values** replace `ThreadLocal` for virtual threads
- Virtual threads **don't replace** Cats Effect/ZIO for complex concurrent logic, but they simplify simple I/O services
- **Pinning** (`synchronized` + blocking) wastes carrier threads — use `ReentrantLock` instead
- This is the biggest change to JVM concurrency since native threads in 1998

---

[← Previous: java.util.concurrent](17-juc-toolbox.md) · [Next: Part VI — Performance →](../part-6-performance/README.md)
