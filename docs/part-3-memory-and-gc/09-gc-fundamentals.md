# Chapter 9 — Garbage Collection Fundamentals

[← Previous: Object Layout](08-object-layout.md) · [Next: GC Tour →](10-gc-tour.md)

---

## Why Garbage Collection?

In C and C++, you manually allocate and free memory:

```c
int* data = malloc(sizeof(int) * 100);
// use data...
free(data);  // Forget this? Memory leak. Call it twice? Crash.
```

The JVM frees you from this. You create objects; the **garbage collector (GC)** automatically finds and reclaims objects that are no longer in use. You never call `free()`.

This sounds simple, but the engineering behind it is remarkably sophisticated. Let's understand how it works.

## What Is "Garbage"?

An object is garbage when **no live code can possibly reach it**. The formal term is **unreachable**.

```scala
def process(): Unit =
  val temp = List(1, 2, 3)   // 'temp' is reachable here
  val result = temp.sum
  println(result)
  // After this method returns, 'temp' is unreachable → garbage
```

The GC doesn't use reference counting (like Python or Swift). Reference counting breaks with circular references:

```scala
class Node(var next: Node = null)

val a = Node()
val b = Node()
a.next = b
b.next = a  // Circular reference!
// Even if nothing else references a or b, their reference counts never reach 0
```

Instead, the JVM uses **tracing** — it starts from known live references and traces everything reachable.

## GC Roots: Where the Trace Starts

The GC needs a starting point — a set of references that are **known to be alive**. These are called **GC roots**:

| GC Root                          | Example                                     |
| -------------------------------- | ------------------------------------------- |
| **Local variables** on the stack | `val x = List(1, 2, 3)` in a running method |
| **Static fields**                | `object Config { val instance = ... }`      |
| **Active threads**               | The `Thread` objects themselves             |
| **JNI references**               | Objects referenced from native code         |
| **Synchronization monitors**     | Objects used as locks (`synchronized`)      |
| **Class loader references**      | Class loaders and the classes they loaded   |

From these roots, the GC follows every reference, transitively, marking everything reachable:

```
GC Roots
   │
   ├──▶ Object A ──▶ Object B ──▶ Object C     ← All reachable (live)
   │
   └──▶ Object D                                ← Reachable (live)

         Object E ──▶ Object F                   ← Unreachable (garbage!)
         Object G ──▶ Object H ──▶ Object G      ← Circular, but unreachable (garbage!)
```

Objects E, F, G, and H are all garbage, even though G and H reference each other. Since no GC root can reach them, they're dead.

## The Core Algorithms

Every GC uses combinations of three fundamental algorithms.

### Mark and Sweep

The simplest approach. Two phases:

**Mark phase**: Starting from GC roots, traverse all reachable objects and mark them (set a flag in their mark word).

**Sweep phase**: Walk the entire heap. Any object not marked is garbage — reclaim its memory.

```
Before GC:
┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐
│ A │ │ B │ │ C │ │ D │ │ E │ │ F │ │ G │
└───┘ └───┘ └───┘ └───┘ └───┘ └───┘ └───┘
  ✓           ✓     ✓                       (marked as reachable)

After sweep:
┌───┐ ┌   ┐ ┌───┐ ┌───┐ ┌   ┐ ┌   ┐ ┌   ┐
│ A │ │   │ │ C │ │ D │ │   │ │   │ │   │
└───┘ └   ┘ └───┘ └───┘ └   ┘ └   ┘ └   ┘
            free    free    free    free
```

**Problem**: After sweeping, memory becomes **fragmented**. You have many small gaps between live objects. Allocating a large object might fail even though there's enough *total* free space — just not contiguous.

### Mark-Compact

Same as mark-and-sweep, but after marking, live objects are **compacted** — slid to one end of the heap:

```
Before:
┌───┐ ┌   ┐ ┌───┐ ┌───┐ ┌   ┐ ┌   ┐ ┌   ┐
│ A │ │   │ │ C │ │ D │ │   │ │   │ │   │

After compaction:
┌───┐ ┌───┐ ┌───┐ ┌                         ┐
│ A │ │ C │ │ D │ │       Free space        │
└───┘ └───┘ └───┘ └                         ┘
```

**Advantage**: No fragmentation. Allocation is as fast as bumping a pointer.

**Disadvantage**: Moving objects means updating every reference that points to them. This is expensive.

### Copying

Instead of compacting in place, divide memory into two halves ("from-space" and "to-space"). Copy live objects from one half to the other, then swap:

```
From-space:                      To-space:
┌───┐ ┌   ┐ ┌───┐ ┌   ┐         ┌                              ┐
│ A │ │   │ │ C │ │   │  ──▶    │ A │ C │     Free space       │
└───┘ └   ┘ └───┘ └   ┘         └───┘───┘                      ┘
                                 (compacted, no fragmentation)

Then swap: to-space becomes from-space for next cycle.
```

**Advantage**: Live objects end up compacted. Allocation is just a pointer bump. Only need to visit *live* objects (not the entire heap).

**Disadvantage**: Half the memory is always empty (wasted). This is acceptable when most objects are garbage (which is true in the young generation).

> **Key insight**: If 95% of objects are garbage, a copying collector only needs to copy the 5% that are alive. This is incredibly efficient for the young generation, where the survival rate is typically 1–5%.

## Stop-the-World Pauses

All the classic GC algorithms have a dirty secret: they need to **stop all application threads** while they work. This is called a **stop-the-world (STW) pause**.

Why? If your threads are modifying object references while the GC is tracing them, the GC could miss a live object (and free it!) or follow a stale reference. The simplest solution is to freeze everything.

```
Application threads:  ──────────┤ PAUSE ├──────────
                                    │
GC thread:                     ┌────┴────┐
                               │ Mark &  │
                               │ Collect │
                               └─────────┘
```

STW pauses are the main source of latency spikes in JVM applications. A typical minor GC pause is 1–10 ms. A major GC pause can be 100 ms or more. For a web service with a 50 ms SLA, a 200 ms pause is catastrophic.

Modern GCs (G1, ZGC, Shenandoah) work hard to minimize or eliminate STW pauses, doing as much work as possible *concurrently* — while your application keeps running.

## Safepoints: Where the JVM Can Pause You

The JVM can't just stop a thread at any arbitrary point. It needs to stop threads at **safepoints** — specific locations in the code where the JVM knows the state of the stack and registers.

Safepoints are inserted by the JIT compiler at:
- Method returns
- Loop back-edges (the jump back to the top of a loop)
- Allocation points

When the GC needs to stop the world, it sets a flag. Each thread checks this flag at its next safepoint and suspends itself.

```java
// Safepoints are inserted at loop back-edges:
for (int i = 0; i < 1000000; i++) {
    // ... work ...
    // <<< safepoint check here (back-edge of loop) >>>
}
```

> **Gotcha**: A loop that the JIT has determined is "counted" (bounded, with a simple int counter) might have its safepoint checks **removed** as an optimization. This can cause **long time-to-safepoint** — one thread runs a tight loop while all other threads (and the GC) wait for it to reach a safepoint.
>
> This is a real problem. If you see mysterious long GC pauses but the GC itself ran quickly, check time-to-safepoint. Use `-XX:+PrintSafepointStatistics` (or `-Xlog:safepoint` in modern JVMs).

## Generational Collection: Putting It Together

Combining the core algorithms with the generational heap design ([Chapter 6](../part-2-jvm-architecture/06-runtime-data-areas.md)):

### Minor GC (Young Generation)

1. Eden fills up → trigger minor GC
2. Uses a **copying** algorithm
3. Copy surviving objects from Eden and the active Survivor space to the other Survivor space
4. Objects that have survived enough cycles → promote to Old Generation
5. Clear Eden and the old Survivor space

This is fast because:
- Most objects are dead (weak generational hypothesis) → very few objects to copy
- No fragmentation (copying collector)
- Only scans the young generation, not the entire heap

### Major GC / Full GC (Old Generation)

1. Old Generation fills up → trigger major GC
2. Uses **mark-compact** or **mark-sweep** depending on the collector
3. Scans the *entire heap* (or large portions of it)
4. Much slower than minor GC

### The Card Table: Connecting Generations

One complication: an object in the Old Generation might reference an object in the Young Generation. When doing a minor GC, we need to know about these cross-generational references without scanning the entire old generation.

The solution is the **card table** — a data structure that divides the old generation into 512-byte "cards." When an old-generation object's reference field is written, the corresponding card is marked "dirty." During minor GC, only dirty cards need to be scanned.

```
Old Generation:
┌──────┬──────┬──────┬──────┬──────┐
│Card 0│Card 1│Card 2│Card 3│Card 4│
│      │DIRTY │      │DIRTY │      │
└──────┴──────┴──────┴──────┴──────┘
                │              │
                ▼              ▼
         Young Gen obj   Young Gen obj

Minor GC only needs to check Card 1 and Card 3 for old→young references.
```

> **The write barrier**: Every time a reference field is written, the JVM executes a tiny "write barrier" — a few instructions that mark the card table. This is the cost of generational collection: a small overhead on every reference write. It's almost always worth it.

## Finalization and Phantom References

A note on finalization: Java has `Object.finalize()`, which the GC calls before reclaiming an object. **Don't use it.** It's deprecated (Java 9), unreliable, and makes objects survive at least one extra GC cycle (they get put on a finalization queue).

Instead, use:
- `try-with-resources` / Scala's `Using` for deterministic cleanup
- `Cleaner` (Java 9+) for registering cleanup actions
- `PhantomReference` for post-mortem notifications

```scala
// Scala: Using for deterministic resource cleanup
import scala.util.Using

Using(scala.io.Source.fromFile("data.txt")) { source =>
  source.getLines().foreach(println)
}
// File is closed here, deterministically — not waiting for GC
```

## Key Takeaways

- The GC uses **tracing** from GC roots, not reference counting — circular references are handled correctly
- Three core algorithms: **mark-sweep** (simple, causes fragmentation), **mark-compact** (no fragmentation, expensive), **copying** (fast, wastes half the space)
- **Stop-the-world pauses** are the main latency concern; modern GCs minimize them
- **Safepoints** are where the JVM can safely pause threads — counted loops might delay safepoints
- **Generational collection** exploits the fact that most objects die young
- Minor GC (young gen) uses copying and is fast; major GC (old gen) is slower
- The **card table** tracks cross-generational references efficiently
- Don't use `finalize()` — use `Using`, `Cleaner`, or `try-with-resources` instead

---

[← Previous: Object Layout](08-object-layout.md) · [Next: GC Tour →](10-gc-tour.md)
