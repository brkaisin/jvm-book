# Chapter 15 — Threads on the JVM

## What Is a Thread?

A thread is an independent path of execution within your program. When you run a JVM application, you already have multiple threads, even if you never created one yourself:

```bash
# Start a simple "Hello World" and dump its threads
jstack <pid>          # or: jcmd <pid> Thread.print
```

You'll see, among others:

- **main**: your application's entry point
- **GC threads**: several threads for garbage collection (how many depends on the collector and the CPU count)
- **C1/C2 CompilerThreads**: the JIT compilers turning bytecode into native code
- **Reference Handler**: enqueues weak/soft/phantom references once the GC has cleared them
- **Finalizer**: runs `finalize()` methods. Finalization is deprecated for removal (JEP 421, Java 18), but the thread is still there
- **Common-Cleaner**: runs `java.lang.ref.Cleaner` actions, the modern replacement for finalizers
- **Signal Dispatcher**: handles OS signals (for example the `SIGQUIT` that triggers a thread dump)

## Platform Threads: a 1:1 Mapping

Every classic `java.lang.Thread`, now called a **platform thread**, maps directly to an **operating system thread** (a kernel thread). The JVM doesn't schedule them: the OS does.

```text
 Java threads     OS threads              CPU cores

┌──────────┐     ┌─────────────┐        ┌────────────┐
│ Thread 1 │─────│ OS thread 1 │───────▶│ CPU core 0 │◀╌╌╌╌╌╌╌╌╌┐
└──────────┘     └─────────────┘        └────────────┘          ┆
                                                                ┆
┌──────────┐     ┌─────────────┐        ┌────────────┐          ┆
│ Thread 2 │─────│ OS thread 2 │───────▶│ CPU core 1 │          ┆
└──────────┘     └─────────────┘        └────────────┘          ┆
                                                                ┆
┌──────────┐     ┌─────────────┐                                ┆
│ Thread 3 │─────│ OS thread 3 │╌╌ context-switched onto core 0 ┘
└──────────┘     └─────────────┘
```

This has implications:

- **Memory**: each thread reserves a stack, 1 MB by default on 64-bit Linux and macOS (configurable with `-Xss`). This is mostly *reserved* address space that the OS commits lazily, but it adds up, together with the kernel's own per-thread structures.
- **Scheduling**: switching between threads goes through the kernel and costs on the order of microseconds, plus the cache misses that follow.
- **Scaling**: a few thousand threads are fine. Hundreds of thousands are not.

That last point is exactly the problem that virtual threads solve ([Chapter 18](18-virtual-threads.md)). Virtual threads are also `java.lang.Thread` instances, but the JVM multiplexes many of them onto a few platform threads.

> [!NOTE]
> **Before native threads**: the very first JVMs used "green threads", user-space threads managed by the JVM and multiplexed onto a single OS thread. That was simple, but it couldn't use more than one CPU core. Around Java 1.2–1.3 the JVMs switched to native threads, which gave true parallelism. Virtual threads bring back the good part of the idea (cheap user-mode threads) without the single-core limitation.

## Creating Threads

### Java

```java
// Classic: pass a Runnable (preferred over subclassing Thread)
Thread t = new Thread(() ->
    System.out.println("Hello from " + Thread.currentThread().getName()));
t.start();

// Builder API (Java 21+): same thing, more options
Thread worker = Thread.ofPlatform()
    .name("worker-", 0)        // worker-0, worker-1, ...
    .daemon(true)
    .start(() -> System.out.println("Hi from " + Thread.currentThread().getName()));

// And its lightweight sibling (see Chapter 18)
Thread vt = Thread.ofVirtual().start(() -> System.out.println("Hi from a virtual thread"));
```

### Scala

```scala
// Direct thread creation (rarely used in practice)
val t = Thread(() => println(s"Hello from ${Thread.currentThread().getName}"))
t.start()

// In practice, you'd use an ExecutionContext, Future, or an effect system
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

val f = Future {
  println(s"Running on: ${Thread.currentThread().getName}")
  42
}
```

> [!TIP]
> You almost never create platform threads directly. Use thread pools ([Chapter 17](17-juc-toolbox.md)), Scala `Future`s, effect systems (Cats Effect, ZIO), or, for blocking I/O-heavy work, one virtual thread per task. Creating raw threads by hand is like manual memory management: you *can* do it, but you'll regret it.

## Thread Lifecycle

`Thread.getState()` returns one of six states:

```text
  ┌─────┐
  │ NEW │
  └─────┘
     │ start()
     ▼
┌──────────┐      monitor busy      ┌───────────────┐
│          │───────────────────────▶│    BLOCKED    │
│          │◀───────────────────────│               │
│          │    monitor acquired    └───────────────┘
│          │
│          │   wait / join / park   ┌───────────────┐
│          │───────────────────────▶│    WAITING    │
│ RUNNABLE │◀───────────────────────│               │
│          │    notify / unpark     └───────────────┘
│          │
│          │   sleep / timed wait   ┌───────────────┐
│          │───────────────────────▶│ TIMED_WAITING │
│          │◀───────────────────────│               │
│          │   timeout / wake-up    └───────────────┘
│          │
└──────────┘
     │
     │ run() ends
     ▼
┌────────────┐
│ TERMINATED │
└────────────┘
```

- **NEW**: created, `start()` not called yet.
- **RUNNABLE**: ready to run *or* actually running. The JVM doesn't distinguish the two, and a thread blocked in a native socket read also shows as RUNNABLE.
- **BLOCKED**: waiting to enter a `synchronized` block or method because another thread holds the monitor.
- **WAITING**: waiting indefinitely for another thread's action (`Object.wait()`, `Thread.join()`, `LockSupport.park()`, which is what all `java.util.concurrent` locks use underneath).
- **TIMED_WAITING**: like WAITING, but with a timeout.
- **TERMINATED**: `run()` has finished.

A thread that wakes up from `wait()` must re-acquire the monitor, so it can briefly pass through BLOCKED on its way back to RUNNABLE.

## Stopping a Thread: Interruption

There is exactly one supported way to ask a thread to stop: **interrupt it** and let it cooperate.

```java
Thread worker = Thread.ofPlatform().start(() -> {
    while (!Thread.currentThread().isInterrupted()) {
        try {
            doSomeWork();
            Thread.sleep(100);          // blocking calls throw InterruptedException
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();  // restore the flag, then exit
            return;
        }
    }
});

worker.interrupt();   // a polite request, not a kill
```

> [!WARNING]
> The old brute-force methods are gone. `Thread.suspend()` and `Thread.resume()` started throwing `UnsupportedOperationException` in Java 20 and were removed in Java 23. `Thread.stop()` also started throwing in Java 20 and was removed in Java 26. They had been deprecated since 1998 because stopping a thread at an arbitrary point can leave shared objects half-updated. Old binaries that still call them now fail with `NoSuchMethodError`.

In the same spirit of clean-up, the Security Manager can no longer be enabled since Java 24 (JEP 486), so old advice about thread permissions or sandboxing threads with `ThreadGroup` no longer applies. Thread groups still exist, but they're a legacy grouping mechanism you can ignore.

## Synchronization: `synchronized`

When multiple threads access shared mutable state, you need synchronization. The most basic mechanism is `synchronized`:

```java
// Java
public class Counter {
    private int count = 0;

    public synchronized void increment() {
        count++;  // Read + modify + write: must be atomic
    }

    public synchronized int getCount() {
        return count;
    }
}
```

```scala
// Scala
class Counter:
  private var count = 0

  def increment(): Unit = synchronized {
    count += 1
  }

  def getCount: Int = synchronized {
    count
  }
```

In Scala, `synchronized` isn't a keyword: it's a method available on every `AnyRef` (so `synchronized { … }` inside a class means `this.synchronized { … }`). It compiles to the same bytecode as Java's `synchronized` block.

### How `synchronized` Works at the JVM Level

Every object in the JVM can act as a lock, also called a **monitor**. When you enter a `synchronized` block, the JVM:

1. Attempts to acquire the object's monitor
2. If successful, executes the block
3. Releases the monitor when the block exits, even if an exception is thrown

`synchronized` blocks compile to a pair of bytecodes (the compiler also adds an exception handler that runs `monitorexit` on the way out). `synchronized` *methods* don't use these instructions: they're marked with the `ACC_SYNCHRONIZED` flag and the JVM does the same thing implicitly.

```text
monitorenter    // Acquire the lock
// ... critical section ...
monitorexit     // Release the lock
```

Monitors are **reentrant**: a thread that already holds a monitor can enter it again (a `synchronized` method calling another `synchronized` method on the same object doesn't deadlock).

> [!NOTE]
> Only objects with **identity** have a monitor. With Valhalla's value objects (a preview in JDK 28), `synchronized` on a value object throws `IdentityException`. Under that preview, `Integer` and friends become value classes, so the old anti-pattern of synchronizing on a boxed number turns from "subtly broken" into "fails fast". See [Chapter 14](../part-4-type-system/14-value-types-valhalla.md).

### Lock States and Optimization

Most locks are never contended, so HotSpot works hard to make the uncontended case cheap:

```text
   ┌──────────────────────────┐
   │ Unlocked                 │◀───────────────────────┐
   └──────────────────────────┘                        │
        │              ▲                               │
        │ a thread     │ released                      │
        │ locks it, no │                               │
        │ contention   │                               │
        │              │                               │
        ▼              │                               │
   ┌──────────────────────────┐                        │
   │ Lightweight (fast) lock  │                        │ idle for
   │ a CAS on the mark word   │                        │ a while
   └──────────────────────────┘                        │
        │                                              │
        │ another thread wants it                      │
        │ or wait() is called                          │
        ▼                                              │
   ┌──────────────────────────┐                        │
   │ Inflated monitor         │────────────────────────┘
   │ an ObjectMonitor,        │
   │ spin then park           │
   └──────────────────────────┘
```

1. **Lightweight locking**: when there's no contention, acquiring the lock is a single CAS (compare-and-swap) on the object's header, and the thread records the object on a small per-thread *lock stack*. This scheme became the default in Java 23 and the older "stack-locking" implementation was deprecated in Java 24.
2. **Inflated (heavyweight) locking**: when threads actually contend, or someone calls `wait()`, the lock is inflated into a full `ObjectMonitor` with a queue of waiting threads. Contending threads spin briefly, hoping the owner releases soon, then park (state BLOCKED) and let the OS schedule something else. That is the expensive path.

> [!NOTE]
> You may read about **biased locking** in older material: a lock "biased" toward the one thread that always used it. It was disabled by default and deprecated in Java 15 (JEP 374) and its code was removed in Java 18. Modern CPUs made plain CAS cheap enough that the complexity no longer paid off.

The header bits involved (the *mark word*) are described in [Chapter 8](../part-3-memory-and-gc/08-object-layout.md#the-mark-word).

## Common Threading Problems

### Deadlock

Two threads each waiting for a lock the other holds:

```scala
val lockA = new Object
val lockB = new Object

// Thread 1
lockA.synchronized {
  Thread.sleep(100)
  lockB.synchronized {  // Waits for lockB, which Thread 2 holds
    println("Thread 1")
  }
}

// Thread 2
lockB.synchronized {
  Thread.sleep(100)
  lockA.synchronized {  // Waits for lockA, which Thread 1 holds
    println("Thread 2")
  }
}

// DEADLOCK: both threads wait forever
```

The usual cure is to always acquire locks in the same global order. The JVM can detect monitor deadlocks, and `jstack` reports them at the end of the dump:

```text
Found one Java-level deadlock:
=============================
"Thread-1":
  waiting to lock monitor 0x00007f... (object 0x000000..., a java.lang.Object),
  which is held by "Thread-0"
"Thread-0":
  waiting to lock monitor 0x00007f... (object 0x000000..., a java.lang.Object),
  which is held by "Thread-1"
```

### Race Condition

```scala
var counter = 0

// Two threads incrementing the same counter without synchronization.
// counter += 1 is actually: read → increment → write
// These steps can interleave, losing updates:

// Thread 1: reads 5, increments to 6, writes 6
// Thread 2: reads 5 (before Thread 1's write!), increments to 6, writes 6
// Result: 6 instead of 7, a lost update!
```

### Starvation

A thread can't make progress because other threads keep getting the lock (or the CPU) first. Less common but insidious. Fair locks (`new ReentrantLock(true)`) trade some throughput for protection against it.

## Observing Threads: `jstack`

`jstack` (or `jcmd <pid> Thread.print`) is invaluable for diagnosing threading issues. Here's what the output looks like:

```text
"http-handler-1" #12 daemon prio=5 os_prio=0 cpu=512.30ms elapsed=91.02s tid=0x00007f... nid=6659 runnable [0x00007f...]
   java.lang.Thread.State: RUNNABLE
        at com.example.Handler.process(Handler.scala:42)
        at com.example.Server.handle(Server.scala:18)
        ...

"db-pool-1" #15 daemon prio=5 os_prio=0 cpu=3.10ms elapsed=91.00s tid=0x00007f... nid=6662 waiting on condition [0x00007f...]
   java.lang.Thread.State: TIMED_WAITING (parking)
        at jdk.internal.misc.Unsafe.park(Native Method)
        - parking to wait for <0x000000076ab04e10> (a java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject)
        at java.util.concurrent.locks.LockSupport.parkNanos(LockSupport.java:269)
        ...
```

This tells you:

- Thread name, priority, daemon status, and the CPU time it has used so far
- Thread state (RUNNABLE, WAITING, BLOCKED, etc.)
- The full stack trace: exactly what code is running or blocked
- What lock or condition the thread is waiting on

> [!TIP]
> `jstack` only shows platform threads. To include virtual threads (there may be millions), use the newer thread dump, which can write JSON:
> ```bash
> jcmd <pid> Thread.dump_to_file -format=json threads.json
> ```

> **Scala tip**: if you use Cats Effect or ZIO, the JVM stack traces can be misleading because fibers hop between threads. Both libraries provide their own fiber dumps that show the logical fiber state (Cats Effect prints one on `SIGUSR1`/`SIGINFO`, and ZIO has `Fiber.dumpAll`).

## Daemon Threads

Threads are either **daemon** or **non-daemon**:

```java
Thread t = new Thread(runnable);
t.setDaemon(true);  // must be called before start()
t.start();
```

- **Non-daemon threads**: the JVM won't exit until all non-daemon threads finish. Your `main` thread is non-daemon.
- **Daemon threads**: the JVM can exit even if daemon threads are still running (they're simply abandoned). GC and JIT threads are daemons, and so is every virtual thread.

In Scala with Cats Effect or ZIO, the library manages its thread pools, so you typically don't set daemon status manually.

<div class="takeaways">

## Key Takeaways

- A **platform thread** is an OS thread: it reserves a sizeable stack, and the kernel schedules it. Thousands are fine, millions are not (that's what virtual threads are for)
- Threads move through six states: NEW → RUNNABLE ⇄ (BLOCKED / WAITING / TIMED_WAITING) → TERMINATED
- Stop threads by **interruption**. `Thread.stop`, `suspend` and `resume` have been removed
- `synchronized` acquires an object's **monitor**. HotSpot makes the uncontended case a cheap CAS and inflates to a full monitor only under contention. Biased locking is gone
- **Deadlocks**, **race conditions**, and **starvation** are the classic threading bugs
- `jstack` / `jcmd Thread.print` are your go-to tools. Use `jcmd Thread.dump_to_file` when virtual threads are involved
- In practice, **don't create threads directly**: use executors, `Future`, effect systems, or virtual threads

</div>
