# Chapter 18 — Virtual Threads (Project Loom)

## The Problem: Threads Don't Scale

Platform threads are OS threads ([Chapter 15](15-threads.md)). Each one reserves a sizeable stack and is scheduled by the kernel. For 100 concurrent requests, this is fine. For 100,000? Not happening.

But modern services need to handle many concurrent connections, most of which are waiting for I/O (database queries, HTTP calls, file reads). The threads are *idle*, just... waiting.

```text
Traditional model with 10,000 connections:

Thread 1:      ████░░░░░░████░░░░░░████   ← mostly waiting for I/O
Thread 2:      ██░░░░░░░░░░████░░░░████   ← mostly waiting for I/O
...
Thread 10,000: ████░░░░░░░░░░████░░░░██   ← mostly waiting for I/O

10,000 OS threads: gigabytes of stack, mostly doing nothing!
```

This is why reactive programming, async/await, and effect systems exist: to avoid blocking a thread while waiting for I/O. But they add complexity: callbacks, "colored" functions, and a different programming model.

## Virtual Threads: The Solution

**Virtual threads** (JEP 444, final in Java 21) are lightweight threads managed by the JVM, not the OS. They're still `java.lang.Thread` objects, but they're cheap enough that you can have **millions** of them.

```java
// Create and start a virtual thread
Thread.startVirtualThread(() -> {
    var result = fetchFromDatabase();  // This BLOCKS, and that's OK!
    process(result);
});

// Or using the builder:
Thread.ofVirtual().name("worker-", 0).start(() -> {
    // ...
});

// Or, most commonly, one virtual thread per task:
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    executor.submit(() -> handle(request));
}
```

The key insight: **you can write plain blocking code and it scales**. No callbacks, no `async`/`await`, no monadic composition required.

## How Virtual Threads Work

Virtual threads are **multiplexed** (M:N) onto a small pool of platform threads called **carrier threads**. The scheduler is a dedicated `ForkJoinPool` whose parallelism defaults to the number of CPU cores (tunable with `-Djdk.virtualThreadScheduler.parallelism=N`, rarely needed):

```text
┌─ Virtual threads: millions possible ─────────────────────────────┐
│                                                                  │
│ ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────────────┐    │
│ │ VT-1    │   │ VT-4    │   │ VT-2    │   │ VT-3            │    │
│ │ running │   │ ready   │   │ running │   │ waiting for I/O │    │
│ └─────────┘   └─────────┘   └─────────┘   └─────────────────┘    │
│     │              ┆             │                 ┆             │
└─────┼──────────────┼─────────────┼─────────────────┼─────────────┘
      │ mounted on   ┆ queued      │ mounted on      ┆ parked: stack on
      │              ▼             │                 ┆ the heap, no
      │     ┌────────────────────┐ │                 ┆ carrier used
      │     │ Scheduler          │ │                 ▼
      │     │ ForkJoinPool       │ │           ┌───────────┐
      │     └────────────────────┘ │           │ Java heap │
      │         │             │    │           └───────────┘
      ▼         ▼             ▼    ▼
  ┌──────────────────┐  ┌──────────────────┐
  │ Carrier thread 1 │  │ Carrier thread 2 │
  └──────────────────┘  └──────────────────┘
           │                     │
           ▼                     ▼
     ┌────────────┐        ┌────────────┐
     │ CPU core 0 │        │ CPU core 1 │
     └────────────┘        └────────────┘
```

When a virtual thread blocks, for example on a socket read:

```text
 Virtual thread     Carrier thread         Scheduler       OS / I/O poller
       │                   │                   │                   │
       │ runs, mounted     │                   │                   │
       │ on the carrier    │                   │                   │
       │──────────────────▶│                   │                   │
       │                   │                   │                   │
       │ socket read       │                   │                   │
       │ would block       │                   │                   │
       │──────────────────────────────────────────────────────────▶│
       │                   │                   │                   │
       │ unmount: stack    │                   │                   │
       │ frames copied     │                   │                   │
       │ to the heap       │                   │                   │
       │──────────────────────────────────────▶│                   │
       │                   │                   │                   │
       │         ┌───────────────────┐         │                   │
       │         │ carrier is free,  │         │                   │
       │         │ picks up another  │         │                   │
       │         │ virtual thread    │         │                   │
       │         └───────────────────┘         │                   │
       │                   │                   │                   │
       │                   │                   │     data is ready │
       │                   │                   │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│
       │                   │                   │                   │
       │                   │    remount on any │                   │
       │                   │    free carrier   │                   │
       │                   │◀──────────────────│                   │
       │                   │                   │                   │
       │   continues right │                   │                   │
       │   after the read  │                   │                   │
       │◀──────────────────│                   │                   │
       │                   │                   │                   │
       ▼                   ▼                   ▼                   ▼
```

1. It's **unmounted** from its carrier thread (the carrier is freed)
2. Its stack frames are saved as objects on the heap
3. The carrier thread picks up another virtual thread
4. When the I/O completes, the virtual thread is **remounted**, possibly on a different carrier

This is called **parking** and **unparking**. It happens transparently: your code just sees a normal blocking call. The JDK's blocking APIs (sockets, `Thread.sleep`, `BlockingQueue`, locks, `synchronized`, …) have been adapted to park the virtual thread instead of blocking the carrier.

### Stack Chunks

Instead of a fixed OS stack reserved up front, a virtual thread's frames live in **stack chunk objects** on the heap. They only take as much memory as the actual call depth needs, grow as needed, and are garbage collected like any other object.

This is why virtual threads are cheap: creating one is closer to allocating an object than to asking the kernel for a thread.

## Example: 100,000 Virtual Threads

```java
import java.time.Duration;
import java.util.concurrent.Executors;

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (int i = 0; i < 100_000; i++) {
        executor.submit(() -> {
            Thread.sleep(Duration.ofSeconds(1));  // Simulates an I/O wait
            return "done";
        });
    }
}  // close() waits for all tasks to complete

System.out.println("All 100,000 tasks completed!");
```

This creates 100,000 virtual threads, each sleeping for 1 second. With platform threads, you'd need 100,000 OS threads, which most machines refuse long before that. With virtual threads, a handful of carrier threads run them all and the program finishes in about a second.

## Using Virtual Threads Well

Virtual threads are not faster threads: they are *more* threads. Some rules of thumb:

- **They shine for I/O-bound work** (servers, clients, pipelines that wait a lot). For CPU-bound work you still only have as many cores as you have. A fixed pool or parallel streams are the right tool there.
- **Don't pool them.** Pools exist to amortize expensive creation. Create a new virtual thread per task. To limit concurrency against a scarce resource, use a `Semaphore` ([Chapter 17](17-juc-toolbox.md#semaphore)).
- **Go easy on `ThreadLocal` caches.** Thread locals work in virtual threads, but a pattern like "cache one expensive parser per thread" means a million parsers with a million threads. Scoped values (below) are the better fit for passing context.
- **They are always daemon threads**, and they don't show up in `jstack`. Use `jcmd <pid> Thread.dump_to_file -format=json threads.json` to see them.

## Pinning: Mostly Solved

A virtual thread is **pinned** when it can't unmount while blocked, so it keeps its carrier thread busy. If enough virtual threads are pinned at once, the carriers run out and other virtual threads can't make progress, which could even cause deadlocks.

In Java 21 to 23, the main cause was `synchronized`: blocking inside a `synchronized` block (or in `Object.wait()`) pinned the carrier. The standard workaround was to replace `synchronized` with `ReentrantLock` in hot paths, and a lot of libraries did exactly that.

**Since Java 24 (JEP 491), `synchronized` no longer pins.** A virtual thread can now unmount while blocked entering a monitor, while blocked inside one, and while in `Object.wait()`. The JVM tracks monitor ownership by virtual thread rather than by carrier.

```java
synchronized (lock) {
    Thread.sleep(1000);  // Java 24+: the virtual thread unmounts, the carrier is free
}
```

> [!TIP]
> The current advice from the JDK team: use `synchronized` where it's practical (it's more convenient and less error-prone), and use `ReentrantLock` when you need its extra features (`tryLock`, timeouts, conditions). There's no need to revert code that already moved to `ReentrantLock`, but there's no need to write new code that way just for virtual threads either.

A few rare cases still pin, all involving native frames or class initialization:

- A virtual thread calls **native code** (a JNI method, or a foreign function through the FFM API) that blocks, or calls back into Java code that blocks
- It blocks **inside a class initializer** (`static { … }`), or while loading a class to resolve a symbolic reference
- It **waits for a class to be initialized** by another thread

To find these, use JFR: the `jdk.VirtualThreadPinned` event is enabled by default (with a 20 ms threshold) and records why the thread was pinned and which carrier it held. The old `-Djdk.tracePinnedThreads` system property has been removed and no longer has any effect.

```bash
java -XX:StartFlightRecording:filename=rec.jfr ...
jfr print --events jdk.VirtualThreadPinned rec.jfr
```

> **Scala note**: Scala's `synchronized` (and the `synchronized` blocks the compiler generates for Scala 2 `lazy val`s) compiles to the same monitor bytecodes, so it benefits from JEP 491 in exactly the same way. On Java 24+, there's no reason to avoid it on virtual threads.

## Scoped Values <span class="since">Java 25</span>

Frameworks often need to pass context (the current user, a transaction, a trace ID) down through code that doesn't take it as a parameter. The classic tool is `ThreadLocal`, but it's mutable (anyone can call `set()`), its lifetime is unbounded (forget `remove()` and it leaks), and `InheritableThreadLocal` copies values into every child thread. **Scoped values** (JEP 506, final in Java 25) are the replacement designed with virtual threads in mind:

```java
static final ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();

void serve(Request request) {
    User user = authenticate(request);
    ScopedValue.where(CURRENT_USER, user).run(() -> handle(request));
    // CURRENT_USER is not bound here any more
}

void handle(Request request) {
    // Any code called from inside run(...) can read it
    User user = CURRENT_USER.get();
    // ...
}

// call(...) returns a value (and may throw):
Response r = ScopedValue.where(CURRENT_USER, user).call(() -> process(request));
```

Scoped values are:

- **Immutable**: there's no `set()`. A callee can only *rebind* the value for its own callees, with a nested `where(...)`, and the outer binding comes back when that scope ends
- **Bounded**: the binding exists only while `run`/`call` executes, so there's nothing to clean up
- **Cheap to share**: subtasks forked in a `StructuredTaskScope` inherit the bindings without copying anything
- **Queryable**: `isBound()`, `orElse(default)` (the default can't be `null`), `orElseThrow(...)`

> [!NOTE]
> Scoped values are inherited by subtasks of a `StructuredTaskScope`, not by threads you start any other way (`Thread.ofVirtual().start(...)`, executors). That's deliberate: inheritance is tied to a structure where the parent is guaranteed to outlive the children.

## Structured Concurrency <span class="preview">Preview in 27</span>

**Structured concurrency** gives concurrent tasks a clear lifetime: they start and end within a lexical scope, the way structured programming did for `goto`. The `StructuredTaskScope` API has been through several previews and was redesigned in Java 25: you now **open** a scope with a static factory and choose its policy with a **Joiner**, instead of subclassing. The version below is the 7th preview in Java 27 (JEP 533), which needs `--enable-preview`. Expect small API changes until it's final.

```text
              ┌──────────────────┐
              │ handle()         │
              │ owner thread     │
              └──────────────────┘
                  │          │
             fork │          │ fork
                  │          │
                  ▼          ▼
   ┌────────────────┐     ┌────────────────┐
   │ findUser()     │     │ fetchOrder()   │
   │ virtual thread │     │ virtual thread │
   └────────────────┘     └────────────────┘
            │                      │
            │                      │
result or   │                      │ result or
failure     │                      │ failure
            │                      │
            ▼                      ▼
       ┌────────────────────────────────┐
       │ scope.join()                   │
       └────────────────────────────────┘
                        │
                        │
                        ▼
    ┌──────────────────────────────────────┐
    │ return Response                      │
    │ scope closed: no task outlives it    │
    └──────────────────────────────────────┘
```

### The Default: All or Nothing

```java
import java.util.concurrent.StructuredTaskScope;
import java.util.concurrent.StructuredTaskScope.Subtask;

Response handle() throws ExecutionException, InterruptedException {
    try (var scope = StructuredTaskScope.open()) {
        Subtask<String>  user  = scope.fork(() -> findUser());
        Subtask<Integer> order = scope.fork(() -> fetchOrder());

        scope.join();   // waits for both; if one fails, the other is cancelled
                        // and join() throws ExecutionException with the cause

        return new Response(user.get(), order.get());
    }
    // close() always waits for the forked threads to finish: nothing leaks
}
```

Each `fork` runs the task in a new virtual thread. Only the thread that opened the scope may fork into it or join it.

### Choosing a Policy with a Joiner

`StructuredTaskScope.open(joiner)` changes what "done" means and what `join()` returns:

| Joiner                                 | `join()`                                                               |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `Joiner.allSuccessfulOrThrow()`        | returns a `List` of all results. Fails fast if any subtask fails       |
| `Joiner.anySuccessfulOrThrow()`        | returns the first successful result and cancels the rest               |
| `Joiner.awaitAllSuccessfulOrThrow()`   | returns nothing. Waits for all, fails fast; read results via `Subtask` |
| `Joiner.allUntil(predicate)`           | waits until the predicate says stop, returns the subtasks              |

A race between replicas, keeping whichever answers first:

```java
import java.util.concurrent.StructuredTaskScope.Joiner;

String fastestQuote() throws ExecutionException, InterruptedException {
    try (var scope = StructuredTaskScope.open(Joiner.<String>anySuccessfulOrThrow())) {
        scope.fork(() -> quoteFrom("provider-a"));
        scope.fork(() -> quoteFrom("provider-b"));
        return scope.join();   // first success wins; the other subtask is cancelled
    }
}
```

### Timeouts and Other Configuration

Timeouts, thread names and thread factories are set through a `Configuration` function:

```java
List<Price> prices(List<Callable<Price>> sources)
        throws ExecutionException, InterruptedException {
    try (var scope = StructuredTaskScope.open(
            Joiner.<Price>allSuccessfulOrThrow(),
            cf -> cf.withTimeout(Duration.ofSeconds(2)).withName("prices"))) {
        sources.forEach(scope::fork);
        return scope.join();
    }
}
```

If the timeout expires, the scope is cancelled (all unfinished subtasks are interrupted) and `join()` throws an `ExecutionException` whose cause is a `StructuredTaskScope.CancelledByTimeoutException`. There's also `StructuredTaskScope.open(cf -> cf.withTimeout(...))` to keep the default policy with a timeout.

Why bother?

- Tasks can't leak: they're confined to the scope
- Failure handling is clear: if one subtask fails, the others are cancelled
- Cancellation is automatic: cancelling a scope interrupts its unfinished subtasks, and `close()` waits for them
- Observability: the JSON thread dump shows each scope with the threads forked into it

> [!NOTE]
> Code written for the older previews (`new StructuredTaskScope.ShutdownOnFailure()` followed by `throwIfFailed()`) no longer compiles. Java 25 replaced those subclasses with `open()` and Joiners, and Java 27 added a third type parameter so that `join()` can declare its exception type.

## What This Means for Scala

Virtual threads overlap with problems that Scala's effect systems already solve. Here's how they compare.

### Cats Effect Fibers vs Virtual Threads

| Aspect                     | Cats Effect `IO` / Fiber                     | Virtual Threads                          |
| -------------------------- | -------------------------------------------- | ---------------------------------------- |
| **Programming model**      | Monadic (for-comprehension)                  | Direct style (plain blocking code)       |
| **Cancellation**           | Built-in, with finalizers and masking        | Interruption (`Thread.interrupt()`)      |
| **Error handling**         | `MonadError`, `raiseError` / `handleError`   | try/catch                                |
| **Resource safety**        | `Resource`                                   | try-with-resources                       |
| **Structured concurrency** | `both`, `race`, `parTraverse`, `Supervisor`  | `StructuredTaskScope` (preview)          |
| **Scheduler**              | Cats Effect's own work-stealing runtime      | JDK `ForkJoinPool` of carrier threads    |
| **Composability**          | Referentially transparent                    | Side-effecting                           |
| **Learning curve**         | Steep                                        | Gentle (normal Java/Scala)               |

### Will Virtual Threads Replace Effect Systems?

**No**, but they change the trade-offs:

- For **simple I/O services** (CRUD, REST APIs), virtual threads let you write straightforward blocking code that scales. You might not *need* an effect system.
- For **complex concurrent logic** (racing, timeouts, retries, resource management, backpressure, streaming), effect systems still give stronger guarantees and better composability.
- The effect systems **integrate with Loom** rather than compete with it. Cats Effect 3.6 detects when it is running on a virtual thread and blocks in place instead of shifting work to its blocking pool. ZIO 2.1 offers opt-in runtime layers (`Runtime.enableLoomBasedExecutor`, `Runtime.enableLoomBasedBlockingExecutor`) to run fibers or blocking work on virtual threads on JDK 21+. Their own fiber schedulers are still the default, since they're tuned for their workloads.

### Direct-Style Scala on Loom: Ox

There's also a middle path: keep writing plain, direct-style Scala, but get structured concurrency with a Scala-friendly API. **Ox**, from SoftwareMill (requires JDK 21+ and Scala 3), builds exactly that on virtual threads:

```scala
import ox.*
import scala.concurrent.duration.*

// Run two blocking computations in parallel, in virtual threads
val (user, order) = par(findUser(), fetchOrder())

// Structured concurrency: forks can't outlive the supervised block
val result = supervised {
  val f1 = fork { sleep(2.seconds); 1 }
  val f2 = fork { sleep(1.second); 2 }
  f1.join() + f2.join()
}

// First success wins
val quote = raceSuccess(quoteFrom("a"), quoteFrom("b"))
```

Ox also provides timeouts, retries, resource scopes, and Go-style channels and flows. It's a good fit if you like the "just block" model but want the safety nets of structured concurrency.

### Using Virtual Threads from Plain Scala

```scala
import java.util.concurrent.Executors
import scala.concurrent.{ExecutionContext, Future}

// An ExecutionContext backed by virtual threads
given ExecutionContext = ExecutionContext.fromExecutor(
  Executors.newVirtualThreadPerTaskExecutor()
)

// Now every Future runs on its own virtual thread
val result = Future {
  val data = fetchFromDatabase()  // Blocks, but that's fine on a virtual thread
  process(data)
}
```

This is handy for wrapping blocking Java libraries (JDBC, legacy SDKs) without sizing a dedicated blocking pool.

<div class="takeaways">

## Key Takeaways

- **Virtual threads** (final since Java 21) are `Thread`s managed by the JVM: cheap to create, multiplexed onto a few carrier threads, with stacks stored on the heap
- You can create **millions** of them: write blocking code and it scales. Don't pool them, and use a `Semaphore` to limit concurrency
- They help **I/O-bound** work, not CPU-bound work
- Since **Java 24 (JEP 491)**, `synchronized` no longer pins carriers. Only native frames and class initialization still pin. Diagnose with the JFR event `jdk.VirtualThreadPinned`
- **Scoped values** (final in Java 25) replace `ThreadLocal` for passing immutable context, and are inherited by structured subtasks
- **Structured concurrency** is still a preview in Java 27: `StructuredTaskScope.open()`, Joiners for policies, `Configuration.withTimeout` for deadlines
- Virtual threads **don't replace** Cats Effect/ZIO for complex concurrent logic, but they simplify simple I/O services, and libraries like Ox bring direct-style structured concurrency to Scala
- This is the biggest change to JVM concurrency since the switch to native threads in the late 1990s

</div>
