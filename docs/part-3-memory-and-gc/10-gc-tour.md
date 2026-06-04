# Chapter 10 — The Garbage Collectors: A Tour

[← Previous: GC Fundamentals](09-gc-fundamentals.md) · [Next: Tuning the GC →](11-gc-tuning.md)

---

## Choosing a Garbage Collector

The JVM comes with several garbage collectors, each designed for different workloads. Picking the right one can make a dramatic difference in your application's behavior. Let's tour all of them.

## Serial GC

**The simplest collector.** Single-threaded for everything — both young and old generation collection.

```bash
java -XX:+UseSerialGC -jar myapp.jar
```

How it works:
- Young gen: Single-threaded **copying** collector
- Old gen: Single-threaded **mark-compact**
- All collections are stop-the-world

```
Application:  ───────────────┤ STW ├───────────────┤ STW ├────────
GC thread:                   │ GC  │               │ GC  │
                             └─────┘               └─────┘
                            (1 thread)            (1 thread)
```

**When to use it:**
- Tiny heaps (< 200 MB)
- Single-core machines (containers with 1 vCPU)
- Client applications where low overhead matters more than pause time
- When you want the simplest, most predictable behavior

**Not suitable for:** Anything with a large heap or low-latency requirements.

## Parallel GC (Throughput Collector)

**Maximize throughput** — minimize the total time spent in GC, even if individual pauses are long.

```bash
java -XX:+UseParallelGC -jar myapp.jar
```

How it works:
- Young gen: Multi-threaded **copying** collector (multiple GC threads work in parallel)
- Old gen: Multi-threaded **mark-compact**
- All collections are still stop-the-world — but they finish faster because multiple threads do the work

```
Application:  ────────────┤  STW  ├────────────────┤  STW  ├────────
GC threads:               │ ████ │                 │ ████  │
                          │ ████ │                 │ ████  │
                          │ ████ │                 │ ████  │
                          └──────┘                 └───────┘
                         (N threads)              (N threads)
```

**When to use it:**
- Batch processing, data crunching, ETL pipelines
- When you care about *total throughput*, not individual request latency
- Default before Java 9

**Not suitable for:** Interactive services where pause time matters.

> **Scala parallel**: If you're running a Spark job, you're typically using Parallel GC. Spark is throughput-oriented — you want to process as many records per second as possible, and occasional long pauses are acceptable.

## CMS (Concurrent Mark-Sweep) — Retired

**Goal: Low pause times** by doing most GC work concurrently with your application.

```bash
# Don't use this for new projects
java -XX:+UseConcMarkSweepGC -jar myapp.jar
```

CMS was **deprecated in Java 9** and **removed in Java 14**. We mention it because:
1. You might encounter it in legacy systems
2. Understanding why it failed is instructive

How it worked:
1. **Initial Mark** (STW, brief): Mark objects directly reachable from GC roots
2. **Concurrent Mark**: Trace all reachable objects *while the application runs*
3. **Remark** (STW, brief): Fix up anything that changed during concurrent mark
4. **Concurrent Sweep**: Free unreachable objects concurrently

What went wrong:
- **No compaction** → fragmentation built up over time → eventually forced a single-threaded full GC (the dreaded "CMS failure" mode, also known as "concurrent mode failure")
- Complex to tune — many interrelated flags
- High CPU overhead during concurrent phases
- Fragmentation could cause unpredictable, catastrophic pauses

**G1 replaced it.** If you see CMS in a production system, migrating to G1 or ZGC is strongly recommended.

## G1 (Garbage First) — The Default

**The balanced collector.** Good throughput *and* reasonable pause times. Default since Java 9.

```bash
java -XX:+UseG1GC -jar myapp.jar    # Default since Java 9
```

G1 uses a fundamentally different heap layout: instead of contiguous young/old generations, the heap is divided into **regions** (typically 2,048 regions, each 1–32 MB):

```
┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐
│  E  │  E  │  S  │  O  │  O  │  H  │  H  │  E  │
├─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┤
│  O  │  O  │  E  │  O  │     │  O  │  E  │  S  │
├─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┤
│  O  │     │  O  │  E  │  O  │  O  │     │  O  │
└─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┘

E = Eden    S = Survivor    O = Old    H = Humongous      = Free
```

Key concepts:

### Regions
Any region can be Eden, Survivor, or Old. The JVM reassigns regions dynamically. This means the young generation can grow or shrink without moving anything.

### Humongous Objects
Objects larger than half a region go into special **humongous regions**. These span multiple contiguous regions and are collected separately. Frequent humongous allocations are a performance problem.

### Collection Sets (CSet)
G1 picks the regions with the most garbage ("garbage first" — hence the name) for collection. It doesn't collect the entire heap at once.

### How G1 Works

**Young-only collections** (minor GC):
1. All Eden and Survivor regions are collected (STW, copying collector)
2. Live objects are moved to Survivor or Old regions
3. Target pause time guides how many regions are collected

**Mixed collections** (old gen cleanup):
1. **Concurrent marking** identifies high-garbage old regions
2. These regions are included in subsequent collections alongside young regions
3. This avoids a massive full-GC pause

**Full GC** (last resort):
If mixed collections can't keep up, G1 falls back to a single-threaded full GC. This is the worst case — you want to avoid it.

### Pause Time Target

G1's killer feature is the **pause time target**:

```bash
java -XX:MaxGCPauseMillis=200 -jar myapp.jar    # Target: 200ms pauses
```

G1 uses historical data to predict how long collecting a set of regions will take. It picks just enough regions to stay within the target. It won't always hit the target (it's a goal, not a guarantee), but it tries.

> **Scala connection**: For a typical Scala web service (http4s, Play, Akka HTTP), G1 with a 100–200ms pause target is a solid default. Most teams don't need to look beyond this.

## ZGC (Z Garbage Collector)

**Sub-millisecond pauses**, regardless of heap size. Even terabyte heaps.

```bash
java -XX:+UseZGC -jar myapp.jar
```

ZGC is designed for applications where latency is critical: trading systems, ad servers, real-time services.

### How ZGC Achieves Sub-Millisecond Pauses

ZGC does almost *everything* concurrently with your application:

| Phase                 | Concurrent? | Duration |
| --------------------- | ----------- | -------- |
| Mark Start            | STW         | < 1 ms   |
| Concurrent Mark       | ✅           | Varies   |
| Mark End              | STW         | < 1 ms   |
| Concurrent Relocation | ✅           | Varies   |

Only two tiny STW pauses, each under 1 ms. The actual work (marking and relocating) happens while your application runs.

### Colored Pointers

ZGC uses a technique called **colored pointers** — it stores GC metadata directly in the unused bits of 64-bit object references:

```
Standard 64-bit pointer:
┌──────────────────────────────────────────────────────────┐
│                    Object address (44 bits)                │
└──────────────────────────────────────────────────────────┘

ZGC colored pointer:
┌────┬────┬────┬────┬──────────────────────────────────────┐
│Fin │Rmp │Mrk1│Mrk0│         Object address (42 bits)      │
└────┴────┴────┴────┴──────────────────────────────────────┘
  GC metadata bits
```

These color bits tell the GC the state of each reference without needing to look at the object itself. This enables concurrent relocation: when ZGC moves an object, it updates the forwarding address and the color bits. The next time your application accesses the reference, a **load barrier** transparently fixes the pointer.

### Generational ZGC (Java 21+)

Since Java 21, ZGC supports generational collection. This significantly reduces memory overhead and CPU usage, because short-lived objects (young generation) are collected more frequently and cheaply.

```bash
java -XX:+UseZGC -XX:+ZGenerational -jar myapp.jar    # Java 21
# In Java 23+, generational is the default mode
```

> **When to use ZGC:**
> - Heap sizes from a few hundred MB to multi-terabyte
> - Latency-sensitive applications (p99 latency matters)
> - When you're willing to trade some throughput for consistent latency
> - Any application where GC pauses are visible to users

## Shenandoah

**Concurrent compaction**, similar goals to ZGC but with a different approach.

```bash
java -XX:+UseShenandoahGC -jar myapp.jar
```

Shenandoah was developed by Red Hat and included in OpenJDK (but not Oracle JDK). Like ZGC, it aims for sub-millisecond STW pauses.

### How Shenandoah Differs from ZGC

| Aspect           | ZGC                                  | Shenandoah                                     |
| ---------------- | ------------------------------------ | ---------------------------------------------- |
| **GC metadata**  | Colored pointers (in reference bits) | Brooks pointers (extra indirection per object) |
| **Barrier type** | Load barrier                         | Load + store barriers                          |
| **Compaction**   | Concurrent, pointer coloring         | Concurrent, forwarding pointers                |
| **Heap sizes**   | Designed for multi-terabyte          | Good for medium to large heaps                 |
| **Availability** | Oracle JDK + OpenJDK                 | OpenJDK only (not Oracle JDK)                  |

### Brooks Pointers

Each object has an extra word (the "Brooks pointer") that normally points to itself. When the GC relocates an object, it updates the Brooks pointer to the new location. When your code accesses the object, it follows the indirection.

```
Normal:        Object ──▶ [Brooks ptr ──▶ self] [data...]
After reloc:   Old location [Brooks ptr ──▶ new location] → [data at new loc]
```

## Decision Guide: Which GC to Use

```
                    ┌─────────────────────┐
                    │  What matters most?  │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
         Throughput       Balanced        Low latency
              │                │                │
              ▼                ▼                ▼
        Parallel GC          G1 GC         ZGC or Shenandoah
                                                │
                                    ┌───────────┼───────────┐
                                    ▼                       ▼
                               Oracle JDK?             Any OpenJDK
                                    │                       │
                                    ▼                       ▼
                                  ZGC              ZGC or Shenandoah
```

Quick rules:
- **Default**: G1. It's the default for a reason — it's the best general-purpose choice.
- **Batch/ETL**: Parallel GC. Maximize records-per-second.
- **Low latency**: ZGC (or Shenandoah on OpenJDK). Sub-millisecond pauses.
- **Tiny heap/container**: Serial GC. Minimal overhead.
- **Huge heap (100 GB+)**: ZGC. It was designed for this.

> **For Scala developers**: If you're using Cats Effect, ZIO, or Akka with reactive patterns, G1 is usually fine. If you're seeing GC-related p99 latency issues, ZGC is the answer. The functional style (many short-lived objects) plays well with generational collectors — G1 and Generational ZGC are your best friends.

## Key Takeaways

- **Serial**: Single-threaded, simple, tiny heaps only
- **Parallel**: Multi-threaded STW, best throughput, batch workloads
- **CMS**: Dead. Don't use it. Migrate to G1 or ZGC.
- **G1**: Region-based, balanced, configurable pause targets — the safe default
- **ZGC**: Sub-millisecond pauses via colored pointers and concurrent everything
- **Shenandoah**: Similar goals to ZGC, uses Brooks pointers, OpenJDK only
- G1 is the default since Java 9 and the right choice for most applications
- When latency matters, ZGC is the modern answer

---

[← Previous: GC Fundamentals](09-gc-fundamentals.md) · [Next: Tuning the GC →](11-gc-tuning.md)
