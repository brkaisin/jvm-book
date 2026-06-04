# Chapter 17 — java.util.concurrent: The Toolbox

[← Previous: Java Memory Model](16-java-memory-model.md) · [Next: Virtual Threads →](18-virtual-threads.md)

---

## Beyond `synchronized`

While `synchronized` works, it's a blunt instrument. The `java.util.concurrent` (JUC) package, added in Java 5, provides a rich set of higher-level concurrency primitives. As a Scala developer, you use these — directly or indirectly — every day.

## Thread Pools and Executors

Creating a new thread for every task is expensive (~1 MB memory, OS overhead). Thread pools reuse a fixed set of threads:

```java
// Java
ExecutorService pool = Executors.newFixedThreadPool(4);

pool.submit(() -> {
    System.out.println("Running on: " + Thread.currentThread().getName());
});

pool.shutdown();  // Graceful shutdown — finish pending tasks
```

```scala
// Scala — typically configured via ExecutionContext
import scala.concurrent.ExecutionContext
import java.util.concurrent.Executors

val ec = ExecutionContext.fromExecutorService(
  Executors.newFixedThreadPool(4)
)
```

### Types of Thread Pools

| Factory Method              | Behavior                                       | Use Case                        |
| --------------------------- | ---------------------------------------------- | ------------------------------- |
| `newFixedThreadPool(n)`     | Fixed number of threads                        | Known workload, CPU-bound tasks |
| `newCachedThreadPool()`     | Creates threads as needed, reuses idle ones    | Many short-lived tasks          |
| `newSingleThreadExecutor()` | Single thread, tasks run sequentially          | Ordered task execution          |
| `newScheduledThreadPool(n)` | Supports delayed and periodic tasks            | Timers, periodic jobs           |
| `newWorkStealingPool()`     | Fork/join based, work stealing between threads | Recursive divide-and-conquer    |

### The ForkJoinPool

The `ForkJoinPool` is special — it uses **work stealing**: when a thread finishes its work, it steals tasks from other threads' queues. This balances load automatically.

```
Thread 1 queue: [task1, task2, task3]    ← Busy
Thread 2 queue: []                        ← Idle, steals task3 from Thread 1
Thread 3 queue: [task4]                   ← Working
Thread 4 queue: []                        ← Idle, steals task4 from Thread 3
```

This is the default pool used by:
- **Scala's `ExecutionContext.global`** — a `ForkJoinPool` sized to the number of CPU cores
- **Java's parallel streams** — `list.parallelStream()`
- **Cats Effect's compute pool** — A work-stealing pool

> **Important for Scala**: `ExecutionContext.global` is a `ForkJoinPool` with `Runtime.getRuntime.availableProcessors` threads. This is great for CPU-bound work but terrible for blocking I/O (if all threads are blocked on I/O, no CPU work can run). That's why Cats Effect and ZIO have separate thread pools for blocking operations.

## Futures

### Java's `CompletableFuture`

```java
CompletableFuture<String> future = CompletableFuture
    .supplyAsync(() -> fetchFromDatabase())          // Run async
    .thenApply(data -> transform(data))              // Map the result
    .thenCombine(otherFuture, (a, b) -> merge(a, b)) // Combine two futures
    .exceptionally(ex -> "fallback");                 // Handle errors
```

### Scala's `Future`

```scala
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

val future: Future[String] = for
  data   <- Future(fetchFromDatabase())
  result <- Future(transform(data))
yield result

future.onComplete {
  case Success(value) => println(s"Got: $value")
  case Failure(ex)    => println(s"Error: ${ex.getMessage}")
}
```

### Scala's `Future` vs Cats Effect `IO` vs ZIO

| Feature                       | `Future`                   | `IO` (Cats Effect)           | `ZIO`                |
| ----------------------------- | -------------------------- | ---------------------------- | -------------------- |
| **Eager/Lazy**                | Eager (starts immediately) | Lazy (describes computation) | Lazy                 |
| **Referentially transparent** | No                         | Yes                          | Yes                  |
| **Cancellation**              | No                         | Yes                          | Yes                  |
| **Stack safety**              | Limited                    | Yes (trampolined)            | Yes                  |
| **Resource safety**           | Manual                     | `Resource` monad             | `Scope` / `ZManaged` |
| **Error model**               | `Throwable`                | `Throwable` (or custom)      | Typed errors         |
| **Thread control**            | `ExecutionContext`         | `IORuntime`                  | `Runtime`            |

The critical difference: `Future` **starts executing immediately** when created. `IO` and `ZIO` are **descriptions** of what to do — they don't run until explicitly evaluated. This makes them composable and safe:

```scala
// Future: runs twice (eager)
val f = Future(println("Hello"))
val program = for { _ <- f; _ <- f } yield ()
// Prints "Hello" once (f is already running)

// IO: runs twice (lazy, referentially transparent)
val io = IO(println("Hello"))
val program = for { _ <- io; _ <- io } yield ()
// Prints "Hello" twice when run
```

## Concurrent Data Structures

JUC provides thread-safe collections that don't require external synchronization:

### `ConcurrentHashMap`

The workhorse of concurrent maps. Uses fine-grained locking (per-bucket or lock-striping):

```java
ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>();
map.put("count", 0);
map.compute("count", (key, value) -> value + 1);  // Atomic update
```

```scala
import java.util.concurrent.ConcurrentHashMap

val map = new ConcurrentHashMap[String, Int]()
map.put("count", 0)
map.compute("count", (_, v) => v + 1)  // Atomic
```

### `CopyOnWriteArrayList`

Every write creates a new copy of the underlying array. Reads are lock-free and fast. Good when reads vastly outnumber writes:

```java
CopyOnWriteArrayList<String> list = new CopyOnWriteArrayList<>();
list.add("item");  // Creates a new array copy
```

### `BlockingQueue` Family

Queues that block on take (when empty) or put (when full):

| Class                   | Behavior                                                     |
| ----------------------- | ------------------------------------------------------------ |
| `ArrayBlockingQueue`    | Bounded, backed by array                                     |
| `LinkedBlockingQueue`   | Optionally bounded, backed by linked nodes                   |
| `PriorityBlockingQueue` | Unbounded, elements ordered by priority                      |
| `SynchronousQueue`      | No capacity — each put must wait for a take (and vice versa) |

```java
BlockingQueue<Task> queue = new ArrayBlockingQueue<>(100);

// Producer thread
queue.put(new Task());  // Blocks if queue is full

// Consumer thread
Task task = queue.take();  // Blocks if queue is empty
```

> **Scala connection**: Akka actors' mailboxes are backed by these queues. The default is an unbounded `ConcurrentLinkedQueue`. Bounded mailboxes use `ArrayBlockingQueue` with backpressure.

## Locks

### `ReentrantLock`

Like `synchronized`, but with more features:

```java
ReentrantLock lock = new ReentrantLock();

lock.lock();
try {
    // Critical section
} finally {
    lock.unlock();  // ALWAYS unlock in finally!
}

// Or with tryLock:
if (lock.tryLock(1, TimeUnit.SECONDS)) {
    try {
        // Got the lock within 1 second
    } finally {
        lock.unlock();
    }
} else {
    // Couldn't acquire the lock — handle gracefully
}
```

Advantages over `synchronized`:
- `tryLock()` with timeout — don't wait forever
- `lockInterruptibly()` — can be interrupted while waiting
- Fair mode — threads acquire the lock in FIFO order
- Can be used with `Condition` objects for complex coordination

### `ReadWriteLock`

Allows multiple concurrent readers, but only one writer:

```java
ReadWriteLock rwLock = new ReentrantReadWriteLock();

// Multiple threads can read simultaneously:
rwLock.readLock().lock();
try { /* read shared data */ }
finally { rwLock.readLock().unlock(); }

// Only one thread can write (and no readers during write):
rwLock.writeLock().lock();
try { /* modify shared data */ }
finally { rwLock.writeLock().unlock(); }
```

### `StampedLock` (Java 8)

An optimized read-write lock with an **optimistic read** mode:

```java
StampedLock sl = new StampedLock();

// Optimistic read — no locking! Just check if a write happened
long stamp = sl.tryOptimisticRead();
double x = this.x;
double y = this.y;
if (!sl.validate(stamp)) {
    // A write happened — fall back to a real read lock
    stamp = sl.readLock();
    try {
        x = this.x;
        y = this.y;
    } finally {
        sl.unlockRead(stamp);
    }
}
```

## Atomic Classes

Lock-free thread-safe operations using CPU-level **Compare-And-Swap (CAS)**:

```java
AtomicInteger counter = new AtomicInteger(0);

counter.incrementAndGet();       // Atomically increment
counter.compareAndSet(5, 10);    // If value is 5, set to 10
counter.updateAndGet(x -> x * 2); // Atomically apply function
```

```scala
import java.util.concurrent.atomic.AtomicReference

val ref = new AtomicReference[List[String]](Nil)

// Atomically prepend to list (lock-free!)
var success = false
while !success do
  val current = ref.get()
  success = ref.compareAndSet(current, "new" :: current)

// Or use the built-in updateAndGet:
ref.updateAndGet(list => "new" :: list)
```

### How CAS Works

CAS is a single CPU instruction (`CMPXCHG` on x86):

```
compareAndSet(expected, new):
  atomically {
    if (current_value == expected) {
      current_value = new;
      return true;
    } else {
      return false;  // Someone else changed it — retry
    }
  }
```

This is the foundation of all lock-free algorithms. It's much faster than locking when contention is low.

| Atomic Class             | Purpose                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| `AtomicInteger`          | Atomic int operations                                             |
| `AtomicLong`             | Atomic long operations                                            |
| `AtomicBoolean`          | Atomic boolean                                                    |
| `AtomicReference<T>`     | Atomic reference to any object                                    |
| `LongAdder`              | High-throughput counter (better than AtomicLong under contention) |
| `AtomicStampedReference` | Solves the ABA problem with version stamps                        |

> **Scala connection**: Cats Effect's `Ref` is built on `AtomicReference`:
> ```scala
> import cats.effect.*
>
> val counter: IO[Ref[IO, Int]] = Ref.of[IO, Int](0)
>
> // Atomic update, no explicit CAS loop needed
> counter.flatMap(ref => ref.update(_ + 1))
> ```

## CountDownLatch and CyclicBarrier

### CountDownLatch

Wait for N events to occur:

```java
CountDownLatch latch = new CountDownLatch(3);  // Wait for 3 events

// Worker threads:
new Thread(() -> {
    doWork();
    latch.countDown();  // Signal completion
}).start();
// ... two more similar threads ...

latch.await();  // Main thread blocks until count reaches 0
System.out.println("All 3 workers done!");
```

### CyclicBarrier

All N threads wait for each other, then proceed together:

```java
CyclicBarrier barrier = new CyclicBarrier(3, () -> {
    System.out.println("All threads reached the barrier!");
});

// Each thread:
doPhase1();
barrier.await();  // Wait for all 3 threads
doPhase2();
barrier.await();  // Wait again (cyclic — can reuse!)
doPhase3();
```

## Key Takeaways

- **Thread pools** reuse threads — never create threads manually for each task
- `ForkJoinPool` with **work stealing** is the default for Scala's `global` ExecutionContext
- **Scala `Future`** is eager; **`IO`/`ZIO`** are lazy and referentially transparent
- `ConcurrentHashMap` is the go-to thread-safe map; use `compute()` for atomic updates
- **`ReentrantLock`** adds `tryLock()` and timeouts over `synchronized`
- **Atomic classes** use lock-free CAS operations — faster than locks under low contention
- `LongAdder` beats `AtomicLong` for high-contention counters
- These JUC primitives are the building blocks for Cats Effect `Ref`, `Deferred`, `Queue`, etc.

---

[← Previous: Java Memory Model](16-java-memory-model.md) · [Next: Virtual Threads →](18-virtual-threads.md)
