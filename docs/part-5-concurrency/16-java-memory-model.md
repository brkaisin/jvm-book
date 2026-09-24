# Chapter 16 — The Java Memory Model (JMM)

## Why Do We Need a Memory Model?

Here's a puzzle. This program should print `42`, right?

```java
class Puzzle {
    static int answer = 0;
    static boolean ready = false;

    public static void main(String[] args) {
        // Writer thread
        new Thread(() -> {
            answer = 42;
            ready = true;
        }).start();

        // Reader thread
        new Thread(() -> {
            while (!ready) { /* spin */ }
            System.out.println(answer);
        }).start();
    }
}
```

**Possible outcomes:**

1. `42`: the expected result
2. `0`: the reader sees `ready = true` but `answer = 0` (!)
3. An infinite loop: the reader never sees `ready = true`

How can outcomes 2 or 3 happen? Because modern hardware and compilers play tricks with your code, and the language allows them to, as long as a *single* thread can't tell the difference.

## The Three Enemies of Visibility

### 1. The Compiler Keeping Values in Registers

The JIT compiler is free to read a field once, keep it in a CPU register, and never look at memory again, as long as the current thread doesn't write to it. That is exactly what turns `while (!ready)` into an infinite loop (outcome 3): the loop only ever checks the register copy.

### 2. Store Buffers and Caches

Modern CPUs keep their caches coherent in hardware, so the popular picture of "a stale value sitting in another core's cache forever" is not quite right. The real culprits are the queues *around* the caches: a core puts its writes in a **store buffer** and carries on without waiting for them to reach the cache. Until the buffer drains, other cores see the old value, and they may see two writes land in a different order than they were made.

### 3. Instruction Reordering

Both the compiler and the CPU can **reorder instructions** for performance. As long as the result is the same *from the perspective of a single thread*, they're free to rearrange.

```java
// Your code:
answer = 42;
ready = true;

// Compiler/CPU might effectively execute:
ready = true;    // First!
answer = 42;     // Second
```

A single thread wouldn't notice the difference. But another thread that checks `ready` first would see `answer` as `0` (outcome 2).

## The Java Memory Model (JMM)

The JMM (redesigned by JSR-133 for Java 5, and specified in chapter 17 of the Java Language Specification) is a **formal contract** between your code and the JVM. It specifies:

1. When writes by one thread are **guaranteed to be visible** to reads by another thread
2. Which **reorderings** are allowed

Instead of talking about caches and store buffers, it defines one central relationship: **happens-before**. If your program doesn't establish happens-before between a write and a read in another thread, you get no guarantee at all. If it does, the JVM must insert whatever barriers the hardware needs.

## Happens-Before Rules

If action A **happens-before** action B, then A's effects are **guaranteed visible** to B, and A appears to occur before B from B's point of view.

Here are the key rules.

### Rule 1: Program Order

Within a single thread, each action happens-before every action that comes later in program order:

```java
x = 1;       // Happens-before...
y = x + 1;   // ...this
```

This seems obvious, but it only applies *within one thread*. Across threads, there's no automatic ordering.

### Rule 2: Monitor Lock

Unlocking a monitor happens-before every subsequent locking of that same monitor:

```java
// Thread A:
synchronized (lock) {
    sharedVar = 42;         // Write inside synchronized
}                           // Unlock happens-before...

// Thread B:
synchronized (lock) {       // ...this lock acquisition (if it comes later)
    System.out.println(sharedVar);  // Guaranteed to see 42
}
```

`synchronized` does two things: mutual exclusion *and* memory visibility. Both threads must use the *same* lock object: synchronizing on two different objects gives you neither.

### Rule 3: Volatile Variable

A write to a `volatile` field happens-before every subsequent read of that same field:

```java
volatile boolean ready = false;
int answer = 0;

// Thread A:
answer = 42;
ready = true;     // Volatile write happens-before...

// Thread B:
if (ready) {      // ...this volatile read (when it sees true)
    // Guaranteed to see answer = 42!
}
```

Combined with program order and transitivity, this fixes our puzzle:

```text
 Thread A                         Thread B
     │                                │
     │ answer = 42                    │
     │ ready = true (volatile write)  │
     │                                │
     ├╌╌╌╌╌ happens-before edge ╌╌╌╌╌▶│
     │                                │
     │                                │ reads ready == true (volatile read)
     │                                │ reads answer, guaranteed 42
     │                                │
     ▼                                ▼
```

A useful mental model: a volatile write *publishes* everything the thread did before it, and a volatile read that sees that write *receives* all of it. Not just the volatile variable itself.

### Rule 4: Thread Start

`thread.start()` happens-before any action in the started thread:

```java
answer = 42;
Thread t = new Thread(() -> {
    // Guaranteed to see answer = 42
});
t.start();  // Happens-before the thread's run()
```

### Rule 5: Thread Termination

All actions in a thread happen-before another thread detects that it has finished, for example when `join()` returns:

```java
Thread t = new Thread(() -> {
    answer = 42;  // This write...
});
t.start();
t.join();         // ...happens-before this returns
// Guaranteed to see answer = 42
```

### Rule 6: Transitivity

If A happens-before B, and B happens-before C, then A happens-before C. This is what makes the volatile example above work.

### The Library Rules You Rely on Every Day

The `java.util.concurrent` classes document their own happens-before guarantees, built on the rules above:

- Putting an object into a concurrent collection (`ConcurrentHashMap`, a `BlockingQueue`, …) happens-before another thread retrieves it.
- Submitting a task to an `Executor` happens-before the task runs, and the task's actions happen-before `Future.get()` returns its result.
- Releasing a `Lock`, counting down a `CountDownLatch`, or completing a `CompletableFuture` happens-before the matching acquire, `await()`, or dependent stage.
- Calling `interrupt()` on a thread happens-before that thread sees it is interrupted.

That's why you can hand a plain, mutable object to another thread through a queue or a `Future` without declaring anything `volatile`.

## `volatile`: Visibility Without Mutual Exclusion

`volatile` provides:

- **Visibility**: a read always sees the latest write to that variable
- **Ordering**: surrounding reads and writes can't be reordered across the volatile access in ways that would break the happens-before guarantee

`volatile` does NOT provide:

- **Atomicity** of compound actions: `count++` on a `volatile int` is still read + increment + write

```java
volatile int count = 0;

// Thread A:
count++;  // NOT atomic! Race condition still possible.
// This is: temp = count; temp = temp + 1; count = temp;

// Use AtomicInteger instead:
AtomicInteger atomicCount = new AtomicInteger(0);
atomicCount.incrementAndGet();  // Atomic!
```

> [!NOTE]
> Reads and writes of plain `long` and `double` fields are allowed to be split into two 32-bit halves (tearing). Declaring them `volatile` makes each read and write atomic. On 64-bit JVMs tearing doesn't happen in practice, but the specification allows it.

For experts, `VarHandle` (Java 9) exposes finer-grained access modes than `volatile` (opaque, acquire/release), which is what the JUC classes use internally. Application code rarely needs them.

### When to Use `volatile`

- **Flags**: a simple boolean written by one thread and read by others (`volatile boolean running`)
- **Publication**: making a fully constructed object visible to other threads through a single reference
- **Double-checked locking**, if you must write it by hand (but see the alternatives below):

```java
class Singleton {
    private static volatile Singleton instance;

    static Singleton getInstance() {
        Singleton local = instance;                // one volatile read on the fast path
        if (local == null) {                       // First check (no lock)
            synchronized (Singleton.class) {
                local = instance;
                if (local == null) {               // Second check (with lock)
                    instance = local = new Singleton();
                }
            }
        }
        return local;
    }
}
```

Without `volatile`, another thread might see a non-null `instance` whose fields are not yet initialized: the reference can become visible before the constructor's writes do.

## Lazy Initialization Without the Headache

Double-checked locking is easy to get subtly wrong, and because the field is mutable the JIT can't treat it as a constant. There are simpler options.

### The Holder Idiom

For a `static` value, let the JVM's class initialization do the work. A class is initialized lazily, on first use, exactly once, and the JVM guarantees that everything done in the initializer is visible to every thread that uses the class afterwards:

```java
class Config {
    private static class Holder {
        static final Config INSTANCE = load();   // runs on first access to Holder
    }
    static Config get() { return Holder.INSTANCE; }
}
```

It's safe and fast, but it only works for `static` fields, and you need one holder class per value.

### `LazyConstant` <span class="preview">Preview in 27</span>

`java.lang.LazyConstant` (JEP 531, 3rd preview in Java 27, formerly called *stable values*) packages the idea as an object you can put in any field, static or not:

```java
class OrderController {
    private final LazyConstant<Logger> logger
        = LazyConstant.of(() -> Logger.create(OrderController.class));

    void submitOrder(User user, List<Product> products) {
        logger.get().info("order started");   // computed on first call, once
    }
}
```

The supplier runs **at most once**, even if many threads call `get()` at the same time, and every thread sees the fully initialized value. `null` isn't allowed as a value. There are lazy collections too: `List.ofLazy(size, IntFunction)`, `Map.ofLazy(keys, Function)` and, new in 27, `Set.ofLazy(...)`.

The nice twist is how this ties in with `final`. Internally, the content is marked with the JDK's `@Stable` annotation, so when the field *holding* the `LazyConstant` is `final`, the JIT can treat the value as a true constant once it's set, just like a `static final` field. Double-checked locking can never get that, because its field has to stay mutable. It needs `--enable-preview` for now.

## `final` Fields: Safe Publication

The JMM gives `final` fields a special guarantee (the *final field semantics*): once the constructor finishes, any thread that obtains a reference to the object sees the correct values of its `final` fields, **even if the reference was shared without any synchronization**. The same holds for objects reachable through those fields, as they were at the end of the constructor.

```java
class ImmutableConfig {
    final String name;
    final int maxRetries;

    ImmutableConfig(String name, int maxRetries) {
        this.name = name;
        this.maxRetries = maxRetries;
    }
}

// Once construction is complete, any thread reading this object
// sees the correct name and maxRetries, even through a data race.
```

> [!WARNING]
> The guarantee only holds if `this` doesn't **escape** during construction: don't register the object as a listener, start a thread with it, or store it in a static field from inside its constructor. Another thread could then see it before the fields are set.

> **This is why Scala `val` is so thread-friendly.** A `val` in a class body or constructor compiles to a `final` field. Once the object is constructed, every thread sees the correct value. This is also why immutable case classes are safe to share across threads without synchronization.

```scala
case class Config(name: String, maxRetries: Int)

val config = Config("prod", 3)
// Any thread can read config.name and config.maxRetries safely.
// No synchronization needed: the fields are final.
```

One nuance: a `val` declared in a **trait** is assigned by the trait's initializer through a generated setter, so its underlying field can't be `final`. Objects built from such traits still need a proper publication mechanism (a `volatile`, a concurrent collection, a `Future`…) to be shared safely.

### "Final Means Final" <span class="since">Warnings in Java 26</span>

There has always been a loophole: deep reflection (`Field.setAccessible(true)` followed by `Field.set`) can overwrite a `final` instance field. Some serialization and dependency-injection libraries rely on it. The mere possibility means the JVM can't fully trust `final` fields, which blocks **constant folding**: computing a value once instead of reloading it every time, often the first step in a chain of JIT optimizations. Only `static final` fields, record fields and hidden-class fields have been truly trusted so far.

JEP 500 (Java 26) starts closing the loophole. Mutating a `final` field through deep reflection now prints a warning by default. You can explicitly allow it per module with `--enable-final-field-mutation=ALL-UNNAMED` (or a list of module names), or choose the behavior with `--illegal-final-field-mutation=allow|warn|debug|deny`. A future release will make `deny` the default. Serialization libraries are expected to move to `sun.reflect.ReflectionFactory`, which can create objects without mutating final fields afterwards.

For the memory model, this is good news: once the loophole is closed, "`final` means immutable after construction" becomes a promise the JIT can rely on, not just a convention. If a warning shows up in your logs, it usually points to an old library version.

## Common Visibility Bugs

### Bug 1: The Infinite Loop

```java
class Server {
    boolean running = true;  // NOT volatile!

    void start() {
        new Thread(() -> {
            while (running) {  // Might be hoisted out of the loop by the JIT!
                process();
            }
        }).start();
    }

    void stop() {
        running = false;  // Another thread sets this
    }
}
```

The JIT compiler might optimize the loop to:

```java
if (running) {
    while (true) {  // JIT hoisted the check: 'running' is never re-read
        process();
    }
}
```

**Fix**: make `running` volatile (or use an `AtomicBoolean`, or interrupt the thread).

### Bug 2: Partially Constructed Object

```java
class Holder {
    int value;                  // Non-final field
    Holder(int value) {
        this.value = value;
    }
}

// Shared, non-volatile field:
static Holder holder;

// Thread A:
holder = new Holder(42);

// Thread B (no happens-before with Thread A):
if (holder != null) {
    System.out.println(holder.value);  // Might print 0!
}
```

Without a happens-before relationship, Thread B might see the reference to the `Holder` (non-null) but the `value` field still at its default (0). From Thread B's perspective, the constructor hasn't "finished".

**Fix**: make `value` final, make `holder` volatile, or share the object through a synchronized block or a concurrent collection.

## How Scala Makes Concurrency Safer

Scala's language design pushes you toward patterns that are naturally thread-safe:

| Scala Feature         | JMM Benefit                                                                   |
| --------------------- | ----------------------------------------------------------------------------- |
| `val` (immutable)     | Compiles to a `final` field → safe publication                                |
| `case class`          | All fields are `val` → immutable, thread-safe                                 |
| Immutable collections | No mutation → no synchronization needed                                       |
| `object` singleton    | Created in a static initializer → class-init lock makes it safe               |
| `lazy val`            | Thread-safe one-time initialization, generated by the compiler                |
| `Future` / `IO`       | The library establishes happens-before between steps                          |

> **Meanwhile, in Scala land**: `lazy val` is Scala's built-in answer to double-checked locking. Scala 2 generates double-checked locking for you: an "initialized" flag plus a `synchronized` block on the enclosing object. Scala 3 uses a different scheme that never locks the enclosing object: one thread wins an atomic compare-and-set on the field and computes the value, while threads that lose the race wait for it. Scala 3.8 moved that implementation off `sun.misc.Unsafe`, whose memory-access methods the JDK is phasing out. Either way, the value is computed at most once and safely published, so you get what `LazyConstant` offers Java, minus the constant folding.

The JMM is still relevant in Scala. You need to understand it when:

- Using `var` (mutable fields), including `private var` inside actors or services
- Working with Java libraries that use mutable state
- Writing low-level concurrent code
- Debugging visibility issues in shared mutable state

But Scala's defaults (immutability, functional style) mean you run into JMM issues far less often than in Java.

<div class="takeaways">

## Key Takeaways

- The JMM defines **when** one thread's writes are **visible** to another thread's reads
- Without a **happens-before** relationship, there are **no visibility guarantees**
- Register caching, store buffers, and instruction reordering are the underlying causes of visibility issues
- `synchronized` provides mutual exclusion AND memory visibility. `volatile` provides visibility and ordering, not atomicity
- JUC collections, executors and futures establish happens-before for you
- `final` fields (`val` in Scala) are **safely published** after construction, as long as `this` doesn't escape the constructor
- Prefer the holder idiom, `lazy val`, or `LazyConstant` (preview) over hand-written double-checked locking
- JEP 500 is making `final` truly final, which lets the JIT trust and constant-fold final fields

</div>
