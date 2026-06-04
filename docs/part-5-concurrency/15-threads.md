# Chapter 15 — Threads on the JVM

[← Part V](index.md) · [Next: The Java Memory Model →](16-java-memory-model.md)

---

## What Is a Thread?

A thread is an independent path of execution within your program. When you run a JVM application, you already have multiple threads — even if you never created one yourself:

```bash
# Start a simple "Hello World" and dump its threads
jstack <pid>
```

You'll see:
- **main** — Your application's entry point
- **GC threads** — Several threads for garbage collection
- **JIT compiler threads** — Compiling bytecode to native code
- **Reference handler** — Processing weak/phantom references
- **Finalizer** — Running `finalize()` methods (deprecated but still there)
- **Signal dispatcher** — Handling OS signals

## Thread = OS Thread (1:1 Mapping)

Since Java 1.2 (1998), every JVM `Thread` maps directly to an **operating system thread** (also called a platform thread or kernel thread). The OS scheduler manages them.

```
JVM Thread 1  ←→  OS Thread 1  ←→  CPU Core 0
JVM Thread 2  ←→  OS Thread 2  ←→  CPU Core 1
JVM Thread 3  ←→  OS Thread 3  ←→  CPU Core 0  (context-switched)
```

This has implications:
- **Cost**: Each OS thread consumes ~1 MB of stack memory (configurable with `-Xss`)
- **Limit**: Creating 10,000 threads means 10 GB of stack memory alone
- **Scheduling**: Thread switching is managed by the OS kernel — relatively expensive (~1–10 µs per switch)
- **Scaling**: You typically can't create more than a few thousand threads

> **Before Java 1.2**: The original JVM used "green threads" — user-space threads managed by the JVM, multiplexed onto a single OS thread. This was simpler but couldn't use multiple CPU cores. The switch to native threads enabled true parallelism.

## Creating Threads

### Java

```java
// Option 1: Subclass Thread
Thread t = new Thread() {
    @Override
    public void run() {
        System.out.println("Hello from thread: " + Thread.currentThread().getName());
    }
};
t.start();

// Option 2: Runnable (preferred)
Thread t = new Thread(() -> {
    System.out.println("Hello from thread: " + Thread.currentThread().getName());
});
t.start();
```

### Scala

```scala
// Direct thread creation (rarely used in practice)
val t = new Thread(() => {
  println(s"Hello from thread: ${Thread.currentThread().getName}")
})
t.start()

// In practice, you'd use an ExecutionContext, Future, or an effect system
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

val f = Future {
  println(s"Running on: ${Thread.currentThread().getName}")
  42
}
```

> **In practice**: You almost never create threads directly. You use thread pools (Chapter 17), Scala `Future`s, or effect systems (Cats Effect, ZIO). Direct thread creation is like manual memory management — you *can* do it, but you'll regret it.

## Thread Lifecycle

A thread goes through these states:

```
    ┌───────┐
    │  NEW  │  (created, not yet started)
    └───┬───┘
        │ start()
    ┌───▼──────┐
    │ RUNNABLE │  (ready to run, or actually running on a CPU)
    └───┬──────┘
        │
   ┌────┼──────────────────────────┐
   │    │                          │
   ▼    ▼                          ▼
┌──────────┐  ┌─────────────┐  ┌──────────────────┐
│ BLOCKED  │  │  WAITING    │  │ TIMED_WAITING    │
│          │  │             │  │                  │
│ Waiting  │  │ wait()      │  │ sleep(millis)    │
│ for a    │  │ join()      │  │ wait(millis)     │
│ monitor  │  │ park()      │  │ parkNanos(nanos) │
│ lock     │  │             │  │                  │
└────┬─────┘  └──────┬──────┘  └────────┬─────────┘
     │               │                  │
     └───────────────┼──────────────────┘
                     │
              ┌──────▼──────┐
              │  RUNNABLE   │
              └──────┬──────┘
                     │ run() completes
              ┌──────▼──────┐
              │ TERMINATED  │
              └─────────────┘
```

- **BLOCKED**: Waiting to enter a `synchronized` block (another thread holds the lock)
- **WAITING**: Waiting indefinitely for another thread's action (`Object.wait()`, `Thread.join()`, `LockSupport.park()`)
- **TIMED_WAITING**: Like WAITING, but with a timeout

You can inspect thread states with:
```bash
jstack <pid>           # Dump all threads and their states
jcmd <pid> Thread.print  # Same, using jcmd
```

## Synchronization: `synchronized`

When multiple threads access shared mutable state, you need synchronization. The most basic mechanism is `synchronized`:

```java
// Java
public class Counter {
    private int count = 0;

    public synchronized void increment() {
        count++;  // Read + modify + write — must be atomic
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

### How `synchronized` Works at the JVM Level

Every object in the JVM can act as a lock (also called a **monitor**). When you enter a `synchronized` block, the JVM:

1. Attempts to acquire the object's monitor
2. If successful, executes the block
3. Releases the monitor when the block exits (even if an exception is thrown)

At the bytecode level:

```
monitorenter    // Acquire the lock
// ... critical section ...
monitorexit     // Release the lock
```

### Lock States and Optimization

The JVM optimizes locking through several levels:

1. **Biased locking** (deprecated since Java 15, removed Java 18): When only one thread ever locks the object, the lock is "biased" toward that thread — nearly zero overhead.

2. **Lightweight locking (thin lock)**: When there's no contention, uses a CAS (Compare-And-Swap) operation on the mark word. Very fast.

3. **Heavyweight locking (fat lock)**: When contention is detected, inflates to a full OS mutex. Thread goes to BLOCKED state and is rescheduled by the OS. Expensive.

```
Single thread using lock:
  → Biased lock (nearly free)

Two threads, no real contention:
  → Lightweight lock (CAS, fast)

Multiple threads fighting for the lock:
  → Heavyweight lock (OS mutex, expensive)
```

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

// DEADLOCK — both threads wait forever
```

The JVM can detect deadlocks — `jstack` will report them:
```
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

// Two threads incrementing the same counter without synchronization
// counter++ is actually: read → increment → write
// These can interleave, losing updates

// Thread 1: reads 5, increments to 6, writes 6
// Thread 2: reads 5 (before Thread 1's write!), increments to 6, writes 6
// Result: 6 instead of 7 — lost update!
```

### Starvation

A thread can't make progress because other threads keep getting the lock first. Less common but insidious.

## Observing Threads: `jstack`

`jstack` is invaluable for diagnosing threading issues. Here's a real example of output:

```
"http-handler-1" #12 daemon prio=5 os_prio=0 tid=0x00007f... nid=0x1a03 runnable [0x00007f...]
   java.lang.Thread.State: RUNNABLE
        at com.example.Handler.process(Handler.scala:42)
        at com.example.Server.handle(Server.scala:18)
        ...

"db-pool-1" #15 daemon prio=5 os_prio=0 tid=0x00007f... nid=0x1a06 waiting on condition [0x00007f...]
   java.lang.Thread.State: TIMED_WAITING (parking)
        at jdk.internal.misc.Unsafe.park(Native Method)
        - parking to wait for <0x000000076ab04e10> (a java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject)
        at java.util.concurrent.locks.LockSupport.parkNanos(LockSupport.java:252)
        ...
```

This tells you:
- Thread name, priority, and daemon status
- Thread state (RUNNABLE, WAITING, BLOCKED, etc.)
- Full stack trace — exactly what code is running or blocked
- What lock or condition the thread is waiting on

> **Scala tip**: If you use Cats Effect or ZIO, the actual stack traces can be misleading because fibers hop between threads. Both libraries provide their own fiber dump mechanisms that show the logical fiber state.

## Daemon Threads

Threads are either **daemon** or **non-daemon**:

```java
Thread t = new Thread(runnable);
t.setDaemon(true);  // Daemon thread
t.start();
```

- **Non-daemon threads**: The JVM won't exit until all non-daemon threads finish. Your `main` thread is non-daemon.
- **Daemon threads**: The JVM can exit even if daemon threads are still running. GC threads, JIT threads are daemon threads.

In Scala/Cats Effect/ZIO, the library manages thread pools. You typically don't set daemon status manually.

## Key Takeaways

- Each JVM `Thread` is an **OS thread** — ~1 MB stack memory, expensive to create and switch
- Threads go through states: NEW → RUNNABLE → (BLOCKED/WAITING/TIMED_WAITING) → TERMINATED
- `synchronized` acquires an object's **monitor** — optimized from biased → lightweight → heavyweight locking
- **Deadlocks**, **race conditions**, and **starvation** are the classic threading bugs
- `jstack` is your go-to tool for diagnosing thread issues
- In practice, **don't create threads directly** — use thread pools, `Future`, or effect systems

---

[← Part V](index.md) · [Next: The Java Memory Model →](16-java-memory-model.md)
