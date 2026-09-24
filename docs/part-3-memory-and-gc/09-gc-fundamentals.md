# Chapter 9 — Garbage Collection Fundamentals

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

The JVM doesn't use reference counting (like Python or Swift). Reference counting breaks with circular references:

```scala
class Node(var next: Node = null)

val a = Node()
val b = Node()
a.next = b
b.next = a  // Circular reference!
// Even if nothing else references a or b, their reference counts never reach 0
```

Instead, the JVM uses **tracing**: it starts from known live references and follows everything reachable from them.

## GC Roots: Where the Trace Starts

The GC needs a starting point: a set of references that are **known to be alive**. These are called **GC roots**:

| GC Root                          | Example                                     |
| -------------------------------- | ------------------------------------------- |
| **Local variables** on the stack | `val x = List(1, 2, 3)` in a running method |
| **Static fields**                | `object Config { val instance = ... }`      |
| **Active threads**               | The `Thread` objects themselves             |
| **JNI references**               | Objects referenced from native code         |
| **Synchronization monitors**     | Objects currently used as locks             |
| **Class loader references**      | Class loaders and the classes they loaded   |

From these roots, the GC follows every reference, transitively, marking everything reachable:

```text
┌──────────┐     ┌───┐     ┌───┐     ┌───┐
│ GC roots │────▶│ A │────▶│ B │────▶│ C │
└────┬─────┘     └───┘     └───┘     └───┘
     │           ┌───┐
     └──────────▶│ D │
                 └───┘

┌╌╌╌┐     ┌╌╌╌┐
┆ E ┆╌╌╌╌▶┆ F ┆
└╌╌╌┘     └╌╌╌┘

┌╌╌╌┐     ┌╌╌╌┐
┆ G ┆╌╌╌╌▶┆ H ┆
┆   ┆◀╌╌╌╌┆   ┆
└╌╌╌┘     └╌╌╌┘
```

A, B, C and D are reachable, so they're live. Objects E, F, G, and H (dashed) are all garbage, even though G and H reference each other: no path leads to them from a root, so they're dead.

## The Core Algorithms

Every collector is built from combinations of three fundamental algorithms.

### Mark and Sweep

The simplest approach. Two phases:

**Mark phase**: Starting from GC roots, traverse all reachable objects and mark them. The mark can be a bit in the object header, but most modern collectors keep it in a separate **mark bitmap** (one bit per heap word), which is cheaper to scan and clear.

**Sweep phase**: Walk the heap. Any object not marked is garbage: its memory is added to a *free list*.

Figure 9.1 follows one small heap through all three algorithms of this section. In its top row, marking has found A, C and D reachable, while B, E and F are garbage; the *Mark-sweep* row shows the heap after the sweep.

<figure class="fig">
{{#include ../figures/09-algorithms.svg}}
<figcaption><b>Figure 9.1.</b> The same heap after each core algorithm: mark-sweep leaves holes where the garbage was, mark-compact slides the live objects together, and copying moves them into an empty to-space, leaving the from-space empty.</figcaption>
</figure>

**Problem**: After sweeping, memory becomes **fragmented**: many small gaps between live objects. Allocating a large object might fail even though there's enough *total* free space, just not in one contiguous piece.

### Mark-Compact

Same marking, but afterwards live objects are **compacted**: slid to one end of the heap, as in the *Mark-compact* row of Figure 9.1, so all the free memory forms one contiguous block.

**Advantage**: No fragmentation. Allocation becomes as fast as bumping a pointer.

**Disadvantage**: Moving objects means updating every reference that points to them. This is expensive.

### Copying

Instead of compacting in place, divide memory into two halves ("from-space" and "to-space"). Copy live objects from one half to the other, then swap the roles. In the *Copying* row of Figure 9.1, the top row's heap is the from-space: A, C and D are copied, compacted, into the to-space, and the whole from-space is then free. For the next cycle, the to-space becomes the from-space.

**Advantage**: Live objects end up compacted, allocation is a pointer bump, and the GC only visits *live* objects: the dead ones are never even looked at.

**Disadvantage**: You need spare space to copy into. With a naive two-halves design, half the memory is always empty. This is acceptable when most objects are garbage, which is exactly the case in the young generation (and HotSpot uses small survivor spaces rather than a full half).

> [!IMPORTANT]
> If 95% of objects are garbage, a copying collector only needs to copy the 5% that are alive. The cost is proportional to *live* data, not heap size. This is what makes young-generation collection so cheap: survival rates there are typically a few percent.

## Stop-the-World Pauses

The simplest way to run any of these algorithms is to **stop all application threads** while the GC works. This is called a **stop-the-world (STW) pause**.

Why? If your threads are modifying object references while the GC is tracing them, the GC could miss a live object (and free it!) or follow a stale reference. The simplest solution is to freeze everything, as in the top half of Figure 9.2.

<figure class="fig">
{{#include ../figures/09-pauses.svg}}
<figcaption><b>Figure 9.2.</b> With a stop-the-world collector, every application thread waits at a safepoint while the GC works; a mostly concurrent collector does most of its work alongside the application and stops it only for short pauses.</figcaption>
</figure>

STW pauses are the main source of GC-induced latency spikes. A young-generation pause on a modern collector is typically a few milliseconds; a full collection of a large heap with a STW collector can take hundreds of milliseconds or more. For a web service with a 50 ms SLA, a 200 ms pause is catastrophic.

Modern collectors (G1, ZGC, Shenandoah) do as much work as possible **concurrently**, while your application keeps running (the bottom half of Figure 9.2). ZGC and Shenandoah even move objects concurrently, keeping pauses well under a millisecond. The next sections explain what makes that possible.

## Concurrent Marking and Barriers

To mark while the application runs, collectors use the **tri-color abstraction**. Every object is in one of three states, as Figure 9.3 shows:

<figure class="fig">
{{#include ../figures/09-tricolour.svg}}
<figcaption><b>Figure 9.3.</b> Marking advances from the roots as a grey wavefront, so no black object points to a white one; if the application breaks that rule behind the collector's back, a live object is lost.</figcaption>
</figure>

Marking is done when there are no grey objects left. The danger is that the application, running at the same time, stores a reference to a white object into a black one (which the GC won't scan again) and removes the last other path to it. The white object would then be freed while still in use.

To prevent this, the JIT compiler inserts **barriers**: a few extra instructions around reference reads or writes that let the GC keep track of what the application is doing.

- A **write barrier** (or store barrier) runs when a reference field is written. G1 and Shenandoah use one to record the old value (a *snapshot-at-the-beginning*, or SATB, barrier) so nothing reachable at the start of marking is lost. Generational collectors also use write barriers to maintain the card table, below.
- A **load barrier** runs when a reference is read from the heap. ZGC and Shenandoah use them to fix up pointers to objects that have been moved, which is how they can compact the heap without stopping your threads.

Barriers are the price of concurrency: a small, constant tax on the application's own work, in exchange for much shorter pauses.

## Safepoints: Where the JVM Can Pause You

Even concurrent collectors need short pauses, and the JVM can't stop a thread at any arbitrary machine instruction. It stops threads at **safepoints**: locations in the code where the JVM knows exactly which stack slots and registers hold references.

Safepoint checks are inserted by the JIT compiler at:

- Method returns
- Loop back-edges (the jump back to the top of a loop)

(and the interpreter can stop at any bytecode). When the JVM needs to stop the world, it arms a per-thread poll word; each thread notices at its next safepoint check and parks itself. Since JDK 10, the JVM can also use **thread-local handshakes** (JEP 312) to stop *one* thread at a time for operations that don't need a global pause.

```java
// Safepoint checks sit at loop back-edges:
for (int i = 0; i < 1_000_000; i++) {
    // ... work ...
    // <<< safepoint poll here (back-edge of loop) >>>
}
```

> [!WARNING]
> A slow **time-to-safepoint** can look exactly like a long GC pause: one thread runs a long loop without reaching a safepoint, while every other thread (and the GC) waits for it. Historically C2 removed polls from "counted" `int` loops; since JDK 10 it can use *loop strip mining* (the loop is split into chunks of about 1,000 iterations with a poll between chunks). It's on by default with the concurrent collectors (G1, ZGC, Shenandoah) but off with Serial and Parallel, where throughput matters more. If you see pauses where the GC work itself was short, check with `-Xlog:safepoint` (the old `-XX:+PrintSafepointStatistics` flag no longer exists).

## Generational Collection: Putting It Together

Combining the core algorithms with the generational heap design ([Chapter 6](../part-2-jvm-architecture/06-runtime-data-areas.md)) gives the life cycle of a typical object (Figure 9.4):

<figure class="fig">
{{#include ../figures/09-generations.svg}}
<figcaption><b>Figure 9.4.</b> An object starts in Eden, moves between the survivor spaces with each minor GC it survives, and is promoted to the old generation once its age reaches the tenuring threshold.</figcaption>
</figure>

### Minor GC (Young Generation)

1. Eden fills up → trigger a minor GC
2. Use a **copying** algorithm
3. Copy surviving objects from Eden and the active Survivor space to the other Survivor space
4. Objects that have survived enough cycles (the age in their header, see [Chapter 8](08-object-layout.md)) → promote to the Old Generation
5. Eden and the old Survivor space are now empty and reused as a whole

This is fast because:

- Most objects are dead (the *weak generational hypothesis*) → very few objects to copy
- No fragmentation (copying collector)
- Only the young generation is traced, not the entire heap

### Major GC / Full GC (Old Generation)

1. The Old Generation fills up (or, for concurrent collectors, crosses an occupancy threshold)
2. The collector uses **mark-compact**, **mark-sweep**, or a concurrent variant, depending on the collector
3. It has to trace the *entire* live set
4. Much more expensive than a minor GC; the whole point of G1, ZGC and Shenandoah is to do this work concurrently or incrementally instead of in one big pause

### The Card Table: Connecting Generations

One complication: an object in the Old Generation might reference an object in the Young Generation. That young object is live, but during a minor GC we don't want to trace the whole old generation just to discover it.

The solution is the **card table**: the old generation is divided into 512-byte "cards", with one byte per card in a side table. When a reference field in an old object is written, the write barrier marks the corresponding card "dirty". During a minor GC, only dirty cards need to be scanned for old→young references.

```text
Old Generation:
┌────────┬────────┬────────┬────────┬────────┐
│ Card 0 │ Card 1 │ Card 2 │ Card 3 │ Card 4 │
│        │ DIRTY  │        │ DIRTY  │        │
└────────┴───┬────┴────────┴───┬────┴────────┘
             │                 │
             ▼                 ▼
        Young Gen obj     Young Gen obj

Minor GC only needs to scan Card 1 and Card 3 for old→young references.
```

G1 builds on the same idea with per-region **remembered sets**, and since JDK 26 (JEP 522) it uses two card tables so that application threads and G1's background threads don't have to synchronise; more on that in [Chapter 10](10-gc-tour.md).

> **The write barrier** is the cost of generational collection: a few instructions on every reference write. It's almost always worth it.

## Finalization, Cleaners and Phantom References

A note on finalization: Java has `Object.finalize()`, which the GC arranges to call before reclaiming an object. **Don't use it.** It was deprecated in Java 9 and has been **deprecated for removal** since Java 18 (JEP 421). It is unreliable (no guarantee when, or even whether, it runs), and it makes objects survive at least one extra GC cycle, because they must wait on a finalization queue. You can already run with `--finalization=disabled` to check that your application doesn't depend on it.

Instead, use:

- `try-with-resources` / Scala's `Using` for deterministic cleanup
- `java.lang.ref.Cleaner` (Java 9+) as a safety net for native resources
- `PhantomReference` for post-mortem notifications

```scala
// Scala: Using for deterministic resource cleanup
import scala.util.Using

Using(scala.io.Source.fromFile("data.txt")) { source =>
  source.getLines().foreach(println)
}
// File is closed here, deterministically — not waiting for GC
```

<div class="takeaways">

## Key Takeaways

- The GC uses **tracing** from GC roots, not reference counting, so circular garbage is handled correctly
- Three core algorithms: **mark-sweep** (simple, causes fragmentation), **mark-compact** (no fragmentation, moving is expensive), **copying** (cost proportional to live data, needs spare space)
- **Stop-the-world pauses** are the main latency concern; modern collectors do most work **concurrently**, using **barriers** to stay correct
- **Safepoints** are where the JVM can pause threads; slow time-to-safepoint looks like a GC pause, so check `-Xlog:safepoint`
- **Generational collection** exploits the fact that most objects die young: minor GCs copy the few survivors, major GCs are rarer and costlier
- The **card table** (and G1's remembered sets) track old→young references without scanning the old generation
- Don't use `finalize()` (deprecated for removal); use `Using`, `try-with-resources`, or `Cleaner`

</div>
