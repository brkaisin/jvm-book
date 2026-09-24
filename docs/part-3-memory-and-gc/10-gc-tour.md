# Chapter 10 — The Garbage Collectors: A Tour

## Choosing a Garbage Collector

The JVM comes with several garbage collectors, each designed for different workloads. Picking the right one can make a real difference to your application's latency, throughput and memory footprint. Let's tour all of them.

Here's the line-up in OpenJDK 27 at a glance:

| Collector      | Pauses                          | Best for                                  | Status in JDK 27                                                              |
| -------------- | ------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| **G1**         | Short, with a target (200 ms)   | Almost everything                         | <span class="since">Java 27</span> Default on every machine (JEP 523)         |
| **ZGC**        | Sub-millisecond, any heap size  | Latency-sensitive services, huge heaps    | Generational only (JEP 474 in 23, JEP 490 in 24)                               |
| **Shenandoah** | Sub-millisecond                 | Latency-sensitive services                | Generational mode is a product feature since 25; default mode in 28            |
| **Parallel**   | Long, but efficient             | Batch jobs, maximum throughput            | Supported                                                                      |
| **Serial**     | Long, single-threaded           | Tiny heaps, single-CPU tools              | Supported (no longer picked automatically)                                     |
| **Epsilon**    | None (never collects)           | Benchmarks, very short-lived jobs         | Experimental                                                                   |
| ~~CMS~~        | —                               | —                                         | Removed in Java 14                                                             |

## Serial GC

**The simplest collector.** Single-threaded for everything, both young and old generation collection.

```bash
java -XX:+UseSerialGC -jar myapp.jar
```

How it works:

- Young gen: single-threaded **copying** collector
- Old gen: single-threaded **mark-compact**
- All collections are stop-the-world

```text
Application:  ───────────────┤ STW ├───────────────┤ STW ├────────
GC thread:                   │ GC  │               │ GC  │
                             └─────┘               └─────┘
                            (1 thread)            (1 thread)
```

Until JDK 26, the JVM silently chose Serial when it thought it was running on a small machine: fewer than 2 CPUs or less than 1792 MB of memory. That's a *lot* of containers! Since **JDK 27 (JEP 523)** that special case is gone and G1 is the default everywhere. Serial is still there if you ask for it.

**When to use it:**

- Tiny heaps (up to a few hundred MB) where you want the lowest possible overhead
- Command-line tools and short scripts
- Single-CPU containers, *if you measured* that it beats G1 for your workload

**Not suitable for:** anything with a large heap or low-latency requirements.

## Parallel GC (Throughput Collector)

**Maximise throughput**: minimise the total time spent in GC, even if individual pauses are long.

```bash
java -XX:+UseParallelGC -jar myapp.jar
```

How it works:

- Young gen: multi-threaded **copying** collector
- Old gen: multi-threaded **mark-compact**
- All collections are still stop-the-world, but they finish faster because many threads share the work

```text
Application:  ────────────┤  STW ├─────────────────┤  STW  ├────────
GC threads:               │ ████ │                 │ ████  │
                          │ ████ │                 │ ████  │
                          │ ████ │                 │ ████  │
                          └──────┘                 └───────┘
                         (N threads)              (N threads)
```

**When to use it:**

- Batch processing, data crunching, ETL pipelines
- When you care about *total throughput*, not individual request latency
- It was the default collector on servers before Java 9

**Not suitable for:** interactive services where pause time matters.

> **Scala parallel**: Throughput-oriented jobs such as Spark executors or big sbt builds are the natural home of Parallel GC: you want as many records per second as possible, and an occasional long pause doesn't hurt anyone. That said, G1 has closed much of the gap (see [below](#g1-garbage-first--the-default)), so measure both.

## CMS (Concurrent Mark-Sweep) — Removed

CMS was the first mainstream *concurrent* collector. It was **deprecated in Java 9** and **removed in Java 14**; on a modern JDK, `-XX:+UseConcMarkSweepGC` is an unrecognised option and the JVM refuses to start. We mention it because you'll still find it in old start scripts, and because its failure is instructive.

How it worked:

1. **Initial Mark** (STW, brief): mark objects directly reachable from GC roots
2. **Concurrent Mark**: trace all reachable objects *while the application runs*
3. **Remark** (STW, brief): fix up anything that changed during concurrent mark
4. **Concurrent Sweep**: free unreachable objects concurrently

What went wrong:

- **No compaction** → fragmentation built up over time → eventually a long, stop-the-world full GC (the dreaded "concurrent mode failure")
- Complex to tune, with many interrelated flags
- Unpredictable, occasionally catastrophic pauses

**G1 replaced it.** If you find CMS flags in a start script, delete them and start from G1's defaults (or ZGC if latency is the goal).

## G1 (Garbage First) — The Default

**The balanced collector.** Good throughput *and* predictable pause times. Default on server-class machines since Java 9, and on **every** machine since Java 27.

```bash
java -XX:+UseG1GC -jar myapp.jar    # the default; the flag is only needed to be explicit
```

G1 uses a different heap layout: instead of contiguous young and old generations, the heap is divided into equal-sized **regions** (G1 aims for about 2,048 of them; by default each is 1–32 MB, a power of two). Figure 10.1 shows such a heap.

<figure class="fig">
{{#include ../figures/10-g1-regions.svg}}
<figcaption><b>Figure 10.1.</b> A G1 heap: every region has one role at a time, the roles are scattered rather than contiguous, and a collection takes only a chosen set of regions (outlined), never the whole heap.</figcaption>
</figure>

Key concepts:

### Regions

Any region can be Eden, Survivor, or Old, and the JVM reassigns them dynamically. The young generation can grow or shrink just by changing how many regions it owns, without moving anything.

### Humongous Objects

Objects of at least half a region go into special **humongous regions**, spanning as many contiguous regions as needed. They are expensive to allocate and are only reclaimed under certain conditions, so frequent humongous allocations are a classic G1 performance problem (see the case study in [Chapter 11](11-gc-tuning.md)).

### Collection Sets (CSet)

G1 picks the regions with the most garbage ("garbage first", hence the name) for collection. It never has to collect the whole heap at once.

### How G1 Works

```text
   ┌────────────────────────────────┐  can't keep up
   │ Young-only collections         │╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
   └──▲─────────────┬───────────▲───┘                     ┆
      │             │           │                         ▼
      │             │           │                 ┌──────────────┐
      │             │           └─────────────────│ Full GC      │
      │             │ old gen crosses the         │ last resort  │
      │             │ occupancy threshold         └──────────────┘
      │             ▼                                     ▲
      │  ┌──────────────────────────┐                     ┆
      │  │ Concurrent marking       │                     ┆
      │  └──────────┬───────────────┘                     ┆
      │             │ garbage-rich old                    ┆
      │             │ regions found                       ┆
      │             ▼                                     ┆
      │  ┌──────────────────────────┐  can't keep up      ┆
      │  │ Mixed collections        │╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
      │  │ young + some old regions │
      │  └──────────┬───────────────┘
      │             │ enough old regions reclaimed
      └─────────────┘
```

**Young-only collections** (minor GC):

1. All Eden and Survivor regions are collected (STW, copying, many threads)
2. Live objects are moved to Survivor or Old regions
3. The pause-time target guides how big the young generation can be

**Mixed collections** (old gen cleanup):

1. **Concurrent marking** runs alongside the application and finds old regions with lots of garbage
2. Those regions are added to the next few young collections, a few at a time
3. This avoids ever needing one massive old-generation pause

**Full GC** (last resort): if G1 can't reclaim memory fast enough, it falls back to a stop-the-world, multi-threaded (since Java 10) full compaction. You want to see this rarely, if ever.

### Pause Time Target

G1's killer feature is the **pause time target**:

```bash
java -XX:MaxGCPauseMillis=200 -jar myapp.jar    # 200 ms is the default
```

G1 uses historical data to predict how long collecting a set of regions will take, and picks just enough regions to stay within the target. It won't always hit it (it's a goal, not a guarantee), but it tries.

### What's New in G1

G1 has had a busy few years, and that is precisely why it could become the default everywhere:

- <span class="since">Java 22</span> **Region pinning** (JEP 423): when native code holds a raw pointer into a Java array through a JNI *critical region*, G1 now pins just that region instead of blocking all garbage collection until the native call returns. No more GC stalls caused by JNI-heavy libraries.
- <span class="since">Java 24</span> **Late barrier expansion** (JEP 475): an internal change to how C2 emits G1's barriers, which makes the JIT faster and the barriers easier to maintain.
- <span class="since">Java 26</span> **Better throughput with less synchronisation** (JEP 522): G1 now uses *two* card tables. Application threads dirty one without any synchronisation while G1's background threads process the other, and G1 swaps them when needed. The write barrier drops from around 50 x64 instructions to about 12, which gives 5–15% more throughput for applications that write a lot of references (and up to 5% for others), for about 2 MB of extra native memory per GB of heap.
- <span class="since">Java 27</span> **Default in all environments** (JEP 523): combined with a lower native memory overhead, these improvements make G1 good enough to replace Serial on small machines too.

> **Scala connection**: For a typical Scala web service (http4s, Play, Pekko HTTP, ZIO HTTP), G1 with its default settings is a solid choice. Most teams never need to look beyond it.

## ZGC (Z Garbage Collector)

**Sub-millisecond pauses**, regardless of heap size, from hundreds of megabytes to 16 TB.

```bash
java -XX:+UseZGC -jar myapp.jar    # generational, the only mode since Java 24
```

ZGC is designed for applications where latency is critical: trading systems, ad servers, real-time APIs, big in-memory caches. It became a product feature in Java 15.

### How ZGC Achieves Sub-Millisecond Pauses

ZGC does almost *everything* concurrently with your application, including moving objects. Each collection cycle has only three very short pauses, which don't grow with the heap or the live set:

| Phase                 | Concurrent? | Duration       |
| --------------------- | ----------- | -------------- |
| Pause Mark Start      | STW         | well under 1 ms |
| Concurrent Mark       | Yes         | varies         |
| Pause Mark End        | STW         | well under 1 ms |
| Concurrent prepare    | Yes         | varies         |
| Pause Relocate Start  | STW         | well under 1 ms |
| Concurrent Relocate   | Yes         | varies         |

The actual work (marking and relocating) happens while your application runs.

### Colored Pointers and Barriers

ZGC stores GC metadata directly in object references, a technique called **colored pointers**. In today's (generational) ZGC, the metadata sits in the low-order bits of each 64-bit reference stored in the heap, with the address in the high-order bits:

```text
ZGC colored pointer (as stored in a heap field):
┌──────────────────────────────────────────────┬────────────────────┐
│               object address                 │  metadata "color"  │
└──────────────────────────────────────────────┴────────────────────┘
  high-order bits                                 low-order bits
```

The color tells the GC what state that particular reference is in (already remapped to the object's new location? already marked in this cycle?), without looking at the object itself. The JIT inserts:

- a **load barrier** when a reference is read from the heap: it checks the color and, if the object has moved, fixes the pointer on the spot ("self-healing"), then strips the color before your code uses the reference
- a **store barrier** when a reference is written: it takes care of concurrent marking and of the remembered sets that track old→young pointers

> [!NOTE]
> Older descriptions of ZGC show four color bits (`Finalizable`, `Remapped`, `Marked1`, `Marked0`) above a 42-bit address, and mention that `ps` reports three times the real memory use. That was the original, non-generational ZGC, which relied on mapping the heap three times. Generational ZGC does the work in its barriers instead, and the non-generational mode was removed in Java 24.

### Generational ZGC

Generational ZGC arrived in Java 21 (JEP 439), became the default ZGC mode in Java 23 (JEP 474), and has been the *only* mode since Java 24 (JEP 490). Collecting short-lived objects frequently and cheaply in a young generation greatly reduces ZGC's CPU and memory overhead, which matters a lot for allocation-heavy code such as typical Scala.

```bash
# Java 23+: generational ZGC
java -XX:+UseZGC -jar myapp.jar

# Java 21-22 only; ignored with a warning since Java 24
java -XX:+UseZGC -XX:+ZGenerational -jar myapp.jar
```

> **When to use ZGC:**
> - Heap sizes from a few hundred MB to multi-terabyte
> - Latency-sensitive applications (p99 / p999 latency matters)
> - When you're willing to trade a bit of throughput and memory headroom for consistent latency
> - Any application where GC pauses are visible to users

## Shenandoah

**Concurrent compaction**, with goals similar to ZGC but a different design. Developed by Red Hat, part of OpenJDK since Java 12 and a product feature since Java 15.

```bash
# Single-generation mode (the default mode up to Java 27)
java -XX:+UseShenandoahGC -jar myapp.jar

# Generational mode (product feature since Java 25)
java -XX:+UseShenandoahGC -XX:ShenandoahGCMode=generational -jar myapp.jar
```

Like ZGC, Shenandoah marks and moves objects while the application runs, keeping pauses typically under a millisecond.

> [!WARNING]
> Shenandoah is included in most OpenJDK distributions (Eclipse Temurin, Amazon Corretto, Red Hat builds, …) but **not in Oracle's own JDK builds**. Check your distribution before you standardise on it.

### How Shenandoah Differs from ZGC

| Aspect             | ZGC                                     | Shenandoah                                              |
| ------------------ | --------------------------------------- | ------------------------------------------------------- |
| **Forwarding**     | Colored pointers + forwarding tables    | Forwarding pointer stored in the old copy's mark word    |
| **Barriers**       | Load + store barriers                   | Load-reference barrier + SATB store barrier              |
| **Generational**   | Always (since 24)                       | Opt-in since 25; default mode planned for 28             |
| **Availability**   | All OpenJDK builds, incl. Oracle JDK    | Most OpenJDK builds, not Oracle JDK                      |

### Forwarding Without an Extra Word

When Shenandoah moves an object, the old copy's **mark word** is overwritten with a forwarding pointer to the new copy (tagged with the `11` lock bits we met in [Chapter 8](08-object-layout.md)). A **load-reference barrier** checks, whenever the application loads a reference to an object that may have moved, whether it points into a region being evacuated, and if so follows (and updates) it to the new copy:

```text
┌──────────────┐    stale      ┌──────────────────────────┐
│ Reference    │╌╌╌╌╌╌╌╌╌╌╌╌╌╌▶│ Old copy                 │
│ in a field   │               │ mark word = forwarding   │
└──────┬───────┘               │ pointer                  │
       │                       └────────────┬─────────────┘
       │                                    │
       │                                    ▼
       │  after the barrier    ┌──────────────────────────┐
       └──────────────────────▶│ New copy                 │
          heals it             │ header + fields          │
                               └──────────────────────────┘
```

> [!NOTE]
> Early Shenandoah (up to Java 12) used **Brooks pointers**: an extra word in front of *every* object that normally pointed to itself. Since Java 13 the forwarding pointer lives in the mark word instead, so Shenandoah no longer costs an extra word per object. Many blog posts still describe the old design.

### Generational Shenandoah

The same generational idea is coming to Shenandoah: experimental in Java 24 (JEP 404), a product feature in Java 25 (JEP 521, no longer needs `-XX:+UnlockExperimentalVMOptions`), and planned to become Shenandoah's **default mode in Java 28** (JEP 535).

## Epsilon: The No-Op Collector

Epsilon (JEP 318, Java 11) allocates memory but **never reclaims it**. When the heap is full, the JVM stops with an `OutOfMemoryError`.

```bash
java -XX:+UnlockExperimentalVMOptions -XX:+UseEpsilonGC -Xmx1g -jar myapp.jar
```

That sounds useless, but it's handy for:

- **Performance testing**: measure your code without any GC interference, or measure how much a real collector costs you
- **Very short-lived jobs** that finish before filling the heap
- **Allocation testing**: prove that a hot path doesn't allocate at all

## Decision Guide: Which GC to Use

```text
Start with the default: G1
│
├── Do GC pauses hurt your p99 latency?
│   │
│   ├── No:  Batch job where only total throughput matters?
│   │        ├── No  ──▶ Stay on G1
│   │        └── Yes ──▶ Try Parallel GC, compare with G1
│   │
│   └── Yes: Is Shenandoah in your JDK build, and do you prefer it?
│            ├── No  ──▶ ZGC (-XX:+UseZGC)
│            └── Yes ──▶ Shenandoah, generational mode
│
└╌╌ Also: tiny heap, single CPU, short-lived CLI tool?
         └── Yes ──▶ Consider Serial and measure
```

Quick rules:

- **Default**: G1. It's the default for a reason: the best general-purpose choice, now on every machine.
- **Batch/ETL**: Parallel GC, if measurements show it beats G1 for your job.
- **Low latency**: ZGC (or Shenandoah, if your JDK build includes it). Sub-millisecond pauses.
- **Huge heap (100 GB+)**: ZGC. It was designed for this.
- **Tiny tools**: Serial can still win, but since Java 27 you have to ask for it.
- **Benchmarks and allocation tests**: Epsilon.

> **For Scala developers**: If you're using Cats Effect, ZIO, or Pekko/Akka with reactive patterns, G1 is usually fine. If you're seeing GC-related p99 latency issues, ZGC is the answer. The functional style (many short-lived objects) plays well with generational collectors, and today *all* the main collectors (G1, ZGC, and soon Shenandoah by default) are generational.

<div class="takeaways">

## Key Takeaways

- **G1** is region-based, balanced, with a pause-time target, and since **Java 27 it's the default on every machine**, including small containers (JEP 523)
- G1 keeps improving: region pinning (22), faster write barriers with dual card tables (26)
- **ZGC**: sub-millisecond pauses via colored pointers and load/store barriers; **generational only** since Java 24
- **Shenandoah**: similar goals, forwarding pointers in the mark word (no more Brooks pointers); generational mode is a product feature since 25 and becomes the default in 28; not in Oracle JDK builds
- **Parallel**: multi-threaded STW, best raw throughput for batch workloads
- **Serial**: single-threaded, tiny heaps only, no longer chosen automatically
- **Epsilon**: never collects; for benchmarks and tests
- **CMS**: removed in Java 14; delete its flags

</div>
