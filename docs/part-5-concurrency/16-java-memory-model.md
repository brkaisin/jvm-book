# Chapter 16 — The Java Memory Model (JMM)

[← Previous: Threads](15-threads.md) · [Next: java.util.concurrent →](17-juc-toolbox.md)

---

## Why Do We Need a Memory Model?

Here's a puzzle. This program should print `42`, right?

```java
class Puzzle {
    static int answer = 0;
    static boolean ready = false;

    public static void main(String[] args) throws Exception {
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

**Possible outputs:**
1. `42` — The expected result
2. `0` — The reader sees `ready = true` but `answer = 0` (!)
3. Infinite loop — The reader never sees `ready = true`

How can option 2 or 3 happen? Because modern hardware and compilers play tricks with your code.

## The Three Enemies of Visibility

### 1. CPU Caches

Each CPU core has its own L1/L2 cache. When a core writes to a variable, the new value might sit in *its cache* without being flushed to main memory. Another core reading the same variable sees the *old value* from its own cache.

```
Core 0 cache: answer = 42, ready = true     (written but not flushed)
Core 1 cache: answer = 0,  ready = false    (stale!)
Main memory:  answer = 0,  ready = false    (not updated yet)
```

### 2. Store Buffers

Writes don't go directly to the cache — they go through a **store buffer** first. Reads can bypass the store buffer and see old values.

### 3. Instruction Reordering

Both the compiler and the CPU can **reorder instructions** for performance. As long as the result is the same *from the perspective of a single thread*, they're free to rearrange.

```java
// Your code:
answer = 42;
ready = true;

// Compiler/CPU might reorder to:
ready = true;    // Executed first!
answer = 42;     // Executed second
```

A single thread wouldn't notice the difference. But another thread that checks `ready` first would see `answer` as `0`.

## The Java Memory Model (JMM)

The JMM (defined in JSR-133, part of the Java Language Specification since Java 5) is a **formal contract** between your code and the JVM. It specifies:

1. When writes by one thread are **guaranteed to be visible** to reads by another thread
2. What **reorderings** are allowed

The central concept is the **happens-before** relationship.

## Happens-Before Rules

If action A **happens-before** action B, then:
- A's effects are **guaranteed visible** to B
- A appears to occur **before** B (from B's perspective)

Here are the key happens-before rules:

### Rule 1: Program Order

Within a single thread, each statement happens-before the next:

```java
x = 1;       // Happens-before...
y = x + 1;   // ...this
```

This seems obvious, but it's important: it applies *only within a single thread*. Across threads, there's no automatic ordering.

### Rule 2: Monitor Lock

Unlocking a monitor happens-before every subsequent locking of that same monitor:

```java
// Thread A:
synchronized (lock) {
    sharedVar = 42;         // Write inside synchronized
}                           // Unlock happens-before...

// Thread B:
synchronized (lock) {       // ...this lock acquisition
    System.out.println(sharedVar);  // Guaranteed to see 42
}
```

`synchronized` does two things: mutual exclusion *and* memory visibility.

### Rule 3: Volatile Variable

A write to a `volatile` field happens-before every subsequent read of that field:

```java
volatile boolean ready = false;
int answer = 0;

// Thread A:
answer = 42;
ready = true;     // Volatile write happens-before...

// Thread B:
if (ready) {      // ...this volatile read
    // Guaranteed to see answer = 42!
    // The volatile write "flushed" ALL preceding writes
}
```

A `volatile` write flushes *all* of the writing thread's changes (not just the volatile variable) to main memory. A `volatile` read refreshes the reading thread's view of *all* variables.

### Rule 4: Thread Start

`thread.start()` happens-before any action in the started thread:

```java
answer = 42;
Thread t = new Thread(() -> {
    // Guaranteed to see answer = 42
});
t.start();  // Happens-before the thread's run()
```

### Rule 5: Thread Join

All actions in a thread happen-before `join()` returns:

```java
Thread t = new Thread(() -> {
    answer = 42;  // This write...
});
t.start();
t.join();         // ...happens-before this returns
// Guaranteed to see answer = 42
```

### Rule 6: Transitivity

If A happens-before B, and B happens-before C, then A happens-before C.

## `volatile`: Visibility Without Mutual Exclusion

`volatile` provides:
- **Visibility**: Writes are immediately visible to other threads
- **Ordering**: Prevents reordering of reads/writes around the volatile access

`volatile` does NOT provide:
- **Atomicity**: `volatile int count; count++;` is NOT atomic (it's read + increment + write)

```java
volatile int count = 0;

// Thread A:
count++;  // NOT atomic! Race condition still possible.
// This is: temp = count; temp = temp + 1; count = temp;

// Use AtomicInteger instead:
AtomicInteger count = new AtomicInteger(0);
count.incrementAndGet();  // Atomic!
```

### When to Use `volatile`

- **Flags**: A simple boolean flag read by one thread, written by another
- **Publication**: Making a newly created object visible to other threads
- **Double-checked locking** (if you must):

```java
class Singleton {
    private static volatile Singleton instance;

    static Singleton getInstance() {
        if (instance == null) {                    // First check (no lock)
            synchronized (Singleton.class) {
                if (instance == null) {             // Second check (with lock)
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```

Without `volatile`, another thread might see a partially constructed `instance` (the reference is set before the constructor finishes).

## `final` Fields: Safe Publication

If a field is `final` (or `val` in Scala), the JVM guarantees that once the constructor completes, the field's value is visible to all threads — **even without synchronization**:

```java
class ImmutableConfig {
    final String name;
    final int maxRetries;

    ImmutableConfig(String name, int maxRetries) {
        this.name = name;
        this.maxRetries = maxRetries;
    }
}

// Once construction is complete and the reference is published,
// any thread reading this object sees the correct name and maxRetries.
```

> **This is why Scala `val` is inherently thread-safe.** A `val` compiles to a `final` field. Once the object is constructed, every thread sees the correct value. This is also why immutable case classes are safe to share across threads without synchronization.

```scala
case class Config(name: String, maxRetries: Int)

val config = Config("prod", 3)
// Any thread can read config.name and config.maxRetries safely
// No synchronization needed — all fields are final
```

This is one of the most underappreciated benefits of Scala's preference for immutability.

## Common Visibility Bugs

### Bug 1: The Infinite Loop

```java
class Server {
    boolean running = true;  // NOT volatile!

    void start() {
        new Thread(() -> {
            while (running) {  // Might be hoisted out of the loop by JIT!
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
    while (true) {  // JIT hoisted the check — never re-reads 'running'
        process();
    }
}
```

**Fix**: Make `running` volatile.

### Bug 2: Partially Constructed Object

```java
class Holder {
    int value;
    Holder(int value) {
        this.value = value;  // Non-final field
    }
}

// Thread A:
holder = new Holder(42);

// Thread B (without happens-before):
if (holder != null) {
    System.out.println(holder.value);  // Might print 0!
}
```

Without a happens-before relationship, Thread B might see the reference to `holder` (non-null) but the `value` field still as its default (0). The constructor hasn't "finished" from Thread B's perspective.

**Fix**: Make the field `final`, use `volatile`, or synchronize.

## How Scala Makes Concurrency Safer

Scala's language design pushes you toward patterns that are naturally thread-safe:

| Scala Feature         | JMM Benefit                                                          |
| --------------------- | -------------------------------------------------------------------- |
| `val` (immutable)     | Compiles to `final` → safe publication                               |
| `case class`          | All fields are `val` → immutable, thread-safe                        |
| Immutable collections | No mutation → no synchronization needed                              |
| `object` singleton    | Lazy initialization with thread-safe publication (uses a lock)       |
| `Future` / `IO`       | Thread management handled by the library, with proper happens-before |

The JMM is still relevant in Scala — you need to understand it when:
- Using `var` (mutable fields)
- Working with Java libraries that use mutable state
- Writing low-level concurrent code
- Debugging visibility issues in shared mutable state

But Scala's defaults (immutability, functional style) mean you encounter JMM issues far less often than in Java.

## Key Takeaways

- The JMM defines **when** one thread's writes are **visible** to another thread's reads
- Without a **happens-before** relationship, there are **no visibility guarantees**
- `synchronized` provides mutual exclusion AND memory visibility
- `volatile` provides memory visibility (not atomicity)
- `final` fields (`val` in Scala) are **safely published** after construction
- Scala's preference for **immutability** (`val`, `case class`, immutable collections) makes most code **automatically thread-safe**
- CPU caches, store buffers, and instruction reordering are the underlying causes of visibility issues
- Use `jstack` to inspect thread states; use **volatile flags** for simple stop signals

---

[← Previous: Threads](15-threads.md) · [Next: java.util.concurrent →](17-juc-toolbox.md)
