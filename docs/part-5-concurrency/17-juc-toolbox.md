# Chapter 17 — java.util.concurrent: The Toolbox

## Beyond `synchronized`

While `synchronized` works, it's a blunt instrument. The `java.util.concurrent` (JUC) package, added in Java 5 and extended in almost every release since, provides a rich set of higher-level concurrency primitives. As a Scala developer, you use these every day, directly or through your libraries.

## Thread Pools and Executors

Creating a new platform thread for every task is expensive (a stack, a kernel thread, OS scheduling). Thread pools reuse a fixed set of threads. Since Java 19, `ExecutorService` is `AutoCloseable`: `close()` stops accepting tasks and waits for the submitted ones to finish, so try-with-resources is the tidy way to use a short-lived pool:

```java
// Java
try (ExecutorService pool = Executors.newFixedThreadPool(4)) {
    Future<String> name = pool.submit(() -> Thread.currentThread().getName());
    System.out.println("Ran on: " + name.get());
}   // close(): shutdown() + wait for pending tasks
```

For a long-lived pool (one per application), you still call `shutdown()` (graceful) or `shutdownNow()` (interrupts running tasks) when the application stops.

```scala
// Scala: typically wrapped in an ExecutionContext
import scala.concurrent.ExecutionContext
import java.util.concurrent.Executors

val ec = ExecutionContext.fromExecutorService(
  Executors.newFixedThreadPool(4)
)
```

### Types of Executors

| Factory Method                       | Behavior                                         | Use Case                              |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------- |
| `newFixedThreadPool(n)`              | Fixed number of threads                          | Known workload, CPU-bound tasks       |
| `newCachedThreadPool()`              | Creates threads as needed, reuses idle ones      | Many short-lived tasks                |
| `newSingleThreadExecutor()`          | Single thread, tasks run sequentially            | Ordered task execution                |
| `newScheduledThreadPool(n)`          | Supports delayed and periodic tasks              | Timers, periodic jobs                 |
| `newWorkStealingPool()`              | A `ForkJoinPool`, work stealing between threads  | Many small or recursive tasks         |
| `newVirtualThreadPerTaskExecutor()`  | A new virtual thread per task, no pooling        | Blocking I/O, one task per request    |

The last one (Java 21) is different in kind: it doesn't pool anything, because virtual threads are cheap enough to create one per task ([Chapter 18](18-virtual-threads.md)). Never pool virtual threads. If you need to limit concurrency (say, to 20 simultaneous calls to a fragile service), use a `Semaphore` instead of a small pool.

### The ForkJoinPool

The `ForkJoinPool` is special: it uses **work stealing**. Each worker has its own task queue. When a worker runs out of work, it steals tasks from the other end of another worker's queue, which balances load automatically.

```text
Worker 1 queue: [task1, task2, task3]    ← Busy
Worker 2 queue: []                       ← Idle, steals task3 from Worker 1
Worker 3 queue: [task4]                  ← Working
Worker 4 queue: []                       ← Idle, steals task4 from Worker 3
```

Work-stealing pools are everywhere:

- **Scala's `ExecutionContext.global`**: a `ForkJoinPool` sized to the number of CPU cores
- **Java's parallel streams** and `CompletableFuture.supplyAsync` without an executor: `ForkJoinPool.commonPool()`
- **The virtual thread scheduler**: its own `ForkJoinPool` of carrier threads
- **Cats Effect's compute pool** and ZIO's default executor: not `ForkJoinPool`s, but custom work-stealing schedulers built on the same idea

> [!IMPORTANT]
> `ExecutionContext.global` has only as many threads as CPU cores. That is great for CPU-bound work but terrible for blocking I/O: if every thread is stuck waiting on a socket, no other `Future` can run. Wrap blocking calls in `scala.concurrent.blocking { … }` (which lets the global pool add temporary threads), or run them on a dedicated pool. Cats Effect (`IO.blocking`) and ZIO (`ZIO.attemptBlocking`) have separate blocking pools for the same reason.

## Futures

### Java's `CompletableFuture`

```java
CompletableFuture<String> future = CompletableFuture
    .supplyAsync(() -> fetchFromDatabase())          // Run async (common pool)
    .thenApply(data -> transform(data))              // Map the result
    .thenCombine(otherFuture, (a, b) -> merge(a, b)) // Combine two futures
    .exceptionally(ex -> "fallback");                // Handle errors
```

With virtual threads, many codebases are moving back from `CompletableFuture` chains to plain blocking code in a virtual thread, which is easier to read and debug. `CompletableFuture` is still handy for combining results that genuinely arrive asynchronously.

### Scala's `Future`

```scala
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global
import scala.util.{Failure, Success}

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
| **Cancellation**              | No                         | Yes                          | Yes (interruption)   |
| **Stack safety**              | Limited                    | Yes (trampolined)            | Yes                  |
| **Resource safety**           | Manual                     | `Resource`                   | `Scope`              |
| **Error model**               | `Throwable`                | `Throwable` (or custom)      | Typed errors         |
| **Thread control**            | `ExecutionContext`         | `IORuntime`                  | `Runtime`            |

The critical difference: a `Future` **starts executing immediately** when created. `IO` and `ZIO` are **descriptions** of what to do: they don't run until explicitly evaluated. This makes them composable and safe to reuse:

```scala
// Future: eager, the side effect happens once, when f is created
val f = Future(println("Hello"))
val program = for { _ <- f; _ <- f } yield ()
// Prints "Hello" once: both steps wait on the same, already-running Future

// IO: lazy, each use of io runs the effect again
val io = IO(println("Hello"))
val program2 = for { _ <- io; _ <- io } yield ()
// Prints "Hello" twice when run
```

## Concurrent Data Structures

JUC provides thread-safe collections that don't require external synchronization.

### `ConcurrentHashMap`

The workhorse of concurrent maps. Reads never lock. Since Java 8, writes use a CAS to fill an empty bucket, and otherwise lock only the single bucket they touch (the older "segments" design is gone). Many threads can therefore update different keys in parallel:

```java
var map = new ConcurrentHashMap<String, Integer>();
map.put("count", 0);
map.compute("count", (key, value) -> value + 1);  // Atomic read-modify-write
map.merge("hits", 1, Integer::sum);               // Atomic "insert or add"
```

```scala
import java.util.concurrent.ConcurrentHashMap

val map = ConcurrentHashMap[String, Int]()
map.put("count", 0)
map.compute("count", (_, v) => v + 1)  // Atomic
```

> [!WARNING]
> `if (!map.containsKey(k)) map.put(k, v)` is a race, even on a `ConcurrentHashMap`: another thread can insert between the two calls. Use the atomic methods (`putIfAbsent`, `computeIfAbsent`, `compute`, `merge`) instead. Also keep the functions you pass to them short: they run while the bucket is locked.

### `CopyOnWriteArrayList`

Every write creates a new copy of the underlying array. Reads are lock-free and fast. Good when reads vastly outnumber writes (listener lists, configuration):

```java
var listeners = new CopyOnWriteArrayList<Listener>();
listeners.add(listener);  // Copies the array
```

### `BlockingQueue` Family

Queues that block on `take` (when empty) or `put` (when full):

| Class                   | Behavior                                                     |
| ----------------------- | ------------------------------------------------------------ |
| `ArrayBlockingQueue`    | Bounded, backed by an array                                  |
| `LinkedBlockingQueue`   | Optionally bounded, backed by linked nodes                   |
| `PriorityBlockingQueue` | Unbounded, elements ordered by priority                      |
| `SynchronousQueue`      | No capacity: each put must wait for a take (and vice versa)  |

```java
BlockingQueue<Task> queue = new ArrayBlockingQueue<>(100);

// Producer thread
queue.put(new Task());  // Blocks if the queue is full

// Consumer thread
Task task = queue.take();  // Blocks if the queue is empty
```

Blocking used to be something to avoid. On a virtual thread, a blocked `put` or `take` simply unmounts, so a bounded `BlockingQueue` becomes a cheap and natural way to get backpressure between producers and consumers.

> **Scala connection**: Akka and Apache Pekko actor mailboxes are built on these queues. The default unbounded mailbox is a non-blocking `ConcurrentLinkedQueue`, and bounded mailboxes use blocking queues.

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
    // Couldn't acquire the lock: handle gracefully
}
```

Advantages over `synchronized`:

- `tryLock()` with timeout: don't wait forever
- `lockInterruptibly()`: can be interrupted while waiting
- Fair mode: threads acquire the lock roughly in FIFO order
- Multiple `Condition` objects per lock, for complex coordination

> [!NOTE]
> For a while (Java 21 to 23), `ReentrantLock` was also the standard workaround for virtual threads getting *pinned* inside `synchronized`. Since Java 24 (JEP 491) that's no longer necessary. Today the advice is simple: use `synchronized` where it's enough, and `ReentrantLock` when you need one of the features above.

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

// Optimistic read: no locking! Just check afterwards whether a write happened
long stamp = sl.tryOptimisticRead();
double x = this.x;
double y = this.y;
if (!sl.validate(stamp)) {
    // A write happened: fall back to a real read lock
    stamp = sl.readLock();
    try {
        x = this.x;
        y = this.y;
    } finally {
        sl.unlockRead(stamp);
    }
}
```

Unlike the others, `StampedLock` is **not reentrant**: locking it twice from the same thread deadlocks.

### `Semaphore`

A semaphore hands out a fixed number of permits. It's the idiomatic way to cap concurrency, which matters again with virtual threads:

```java
Semaphore permits = new Semaphore(20);   // at most 20 concurrent calls

String callFragileService(Request r) throws InterruptedException {
    permits.acquire();
    try {
        return client.send(r);
    } finally {
        permits.release();
    }
}
```

## Atomic Classes

Lock-free thread-safe operations using CPU-level **Compare-And-Swap (CAS)**:

```java
AtomicInteger counter = new AtomicInteger(0);

counter.incrementAndGet();         // Atomically increment
counter.compareAndSet(5, 10);      // If value is 5, set to 10
counter.updateAndGet(x -> x * 2);  // Atomically apply a function (retries on conflict)
```

```scala
import java.util.concurrent.atomic.AtomicReference

val ref = AtomicReference[List[String]](Nil)

// Atomically prepend to a list (lock-free!)
var success = false
while !success do
  val current = ref.get()
  success = ref.compareAndSet(current, "new" :: current)

// Or use the built-in updateAndGet, which runs the same loop for you:
ref.updateAndGet(list => "new" :: list)
```

### How CAS Works

CAS is a single atomic CPU instruction (`LOCK CMPXCHG` on x86, `CAS` or a load-linked/store-conditional pair on ARM):

```text
compareAndSet(expected, new):
  atomically {
    if (current_value == expected) {
      current_value = new;
      return true;
    } else {
      return false;  // Someone else changed it: retry
    }
  }
```

This is the foundation of all lock-free algorithms. It's much faster than locking when contention is low. Under heavy contention, many threads retry in a loop, and that's where `LongAdder` comes in.

| Atomic Class             | Purpose                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `AtomicInteger`          | Atomic int operations                                                |
| `AtomicLong`             | Atomic long operations                                               |
| `AtomicBoolean`          | Atomic boolean                                                       |
| `AtomicReference<T>`     | Atomic reference to any object                                       |
| `LongAdder`              | High-throughput counter (spreads updates over cells, sums on read)   |
| `AtomicStampedReference` | Solves the ABA problem with version stamps                           |

> **Scala connection**: on the JVM, Cats Effect's `Ref` is a thin wrapper over an `AtomicReference`:
> ```scala
> import cats.effect.*
>
> val counter: IO[Ref[IO, Int]] = Ref.of[IO, Int](0)
>
> // Atomic update, no explicit CAS loop needed
> counter.flatMap(ref => ref.update(_ + 1))
> ```
> ZIO's `Ref` works the same way.

## CountDownLatch and CyclicBarrier

### CountDownLatch

Wait for N events to occur:

```java
CountDownLatch latch = new CountDownLatch(3);  // Wait for 3 events

// Worker threads:
Thread.ofVirtual().start(() -> {
    doWork();
    latch.countDown();  // Signal completion
});
// ... two more similar threads ...

latch.await();  // Main thread blocks until count reaches 0
System.out.println("All 3 workers done!");
```

### CyclicBarrier

All N threads wait for each other, then proceed together:

```java
CyclicBarrier barrier = new CyclicBarrier(3, () ->
    System.out.println("All threads reached the barrier!"));

// Each thread:
doPhase1();
barrier.await();  // Wait for all 3 threads
doPhase2();
barrier.await();  // Wait again (cyclic: it can be reused!)
doPhase3();
```

`Phaser` is the more flexible cousin, for when the number of parties changes over time.

## Concurrency Inside Streams: `Gatherers.mapConcurrent` <span class="since">Java 24</span>

Stream Gatherers (JEP 485, final in Java 24) let you plug custom intermediate operations into a stream. One of the built-in gatherers is a small concurrency tool in its own right: `Gatherers.mapConcurrent(maxConcurrency, mapper)` runs the mapping function on **virtual threads**, at most `maxConcurrency` at a time, and **preserves the order** of the stream:

```java
import java.util.stream.Gatherers;

List<Profile> profiles = userIds.stream()
    .gather(Gatherers.mapConcurrent(16, id -> httpClient.fetchProfile(id)))  // blocking call
    .toList();
```

If a call fails, the exception is rethrown (wrapped in a `RuntimeException`) and the remaining tasks are cancelled. It's a neat replacement for the old "submit everything to a pool, then collect the futures" dance when all you need is a bounded, ordered, parallel `map` over blocking calls.

<div class="takeaways">

## Key Takeaways

- **Thread pools** reuse platform threads. Since Java 19, `ExecutorService` is `AutoCloseable`, so use try-with-resources for short-lived pools
- For blocking I/O, `Executors.newVirtualThreadPerTaskExecutor()` creates one cheap virtual thread per task. Limit concurrency with a `Semaphore`, not a pool
- `ForkJoinPool` **work stealing** powers Scala's `global` ExecutionContext, parallel streams and the virtual thread scheduler. Don't block on the global pool without `blocking { }`
- **Scala `Future`** is eager. **`IO`/`ZIO`** are lazy and referentially transparent
- `ConcurrentHashMap` is the go-to thread-safe map. Use `compute`/`merge`/`computeIfAbsent` for atomic updates
- **`ReentrantLock`** adds `tryLock()`, timeouts and conditions. It's no longer needed just to avoid virtual thread pinning
- **Atomic classes** use lock-free CAS operations. `LongAdder` beats `AtomicLong` for high-contention counters
- `Gatherers.mapConcurrent` (Java 24) gives you an ordered, bounded, virtual-thread-powered parallel `map` in a stream
- These JUC primitives are the building blocks for Cats Effect's and ZIO's `Ref`, `Deferred`, `Queue`, etc.

</div>
