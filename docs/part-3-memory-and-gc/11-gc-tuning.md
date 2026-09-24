# Chapter 11 — Tuning the GC

## The Golden Rule of GC Tuning

Before we start: **measure, don't guess.** GC tuning without data is like optimising code without profiling: you'll likely make things worse.

```text
                                                             good
┌───────────┐   ┌────────────┐   ┌──────────────┐   ┌─────────┐ enough
│ Enable GC │──▶│ Understand │──▶│ Pick the     │──▶│ Measure │───────▶ Stop
│ logging   │   │ the        │   │ collector,   │   │ again   │
└───────────┘   │ workload   │   │ adjust       │   └────┬────┘
                └─────▲──────┘   │ sizing       │        │
                      │          └──────────────┘        │
                      │         not good enough          │
                      └──────────────────────────────────┘
```

And one more piece of advice, especially if you're upgrading an old service: **start from the defaults.** Many start scripts carry a decade of copy-pasted flags (CMS settings, biased locking, `NewRatio`, `SurvivorRatio`…) that are useless or harmful on a modern JVM. Delete them, measure, and only add back what the data justifies.

## Essential JVM Flags

### Heap Sizing

```bash
# Set initial and maximum heap
java -Xms2g -Xmx2g -jar myapp.jar

# For latency-sensitive production services: set them equal to avoid resizing
```

| Flag                       | Purpose                                                | Example                     |
| -------------------------- | ------------------------------------------------------ | --------------------------- |
| `-Xms`                     | Initial heap size                                      | `-Xms2g`                    |
| `-Xmx`                     | Maximum heap size                                      | `-Xmx2g`                    |
| `-XX:MaxRAMPercentage`     | Maximum heap as a % of available RAM (default 25)      | `-XX:MaxRAMPercentage=75`   |
| `-Xmn`                     | Young generation size (avoid with G1: it disables its adaptive sizing) | `-Xmn512m`  |
| `-XX:MaxMetaspaceSize`     | Cap metaspace growth                                   | `-XX:MaxMetaspaceSize=256m` |
| `-Xss`                     | Thread stack size                                      | `-Xss1m`                    |

### GC Selection

```bash
java -XX:+UseG1GC -jar myapp.jar           # G1 (default everywhere since Java 27)
java -XX:+UseZGC -jar myapp.jar            # ZGC (generational; the only mode since Java 24)
java -XX:+UseShenandoahGC -XX:ShenandoahGCMode=generational -jar myapp.jar
                                           # Shenandoah, generational (product since 25)
java -XX:+UseParallelGC -jar myapp.jar     # Parallel (throughput)
java -XX:+UseSerialGC -jar myapp.jar       # Serial
```

> [!WARNING]
> Flags that no longer do anything, or stop the JVM from starting:
>
> | Flag                        | Status on a current JDK                                             |
> | --------------------------- | ------------------------------------------------------------------- |
> | `-XX:+ZGenerational`        | Ignored with a warning since Java 24 (ZGC is always generational)   |
> | `-XX:+UseConcMarkSweepGC`   | CMS removed in 14; unrecognised option, the JVM won't start         |
> | `-XX:+UseBiasedLocking`     | Biased locking removed in 18; unrecognised, the JVM won't start     |
> | `-XX:LockingMode=…`         | Deprecated in 24, ignored in 26, unrecognised in 27                 |
> | `-XX:+PrintGCDetails`       | Deprecated, mapped to `-Xlog:gc*` with a warning                    |
> | `-XX:+PrintGCDateStamps`    | Unrecognised, the JVM won't start; use `-Xlog` decorations instead  |

### G1-Specific Tuning

G1 has few knobs worth turning. The most useful ones:

```bash
# Target maximum pause time (milliseconds, default 200)
-XX:MaxGCPauseMillis=100

# Region size (auto-calculated; a power of two from 1 MB up to 512 MB)
-XX:G1HeapRegionSize=4m

# Initial old-gen occupancy that starts concurrent marking (default 45%).
# G1 adapts it at runtime (G1UseAdaptiveIHOP), so you rarely need to touch it.
-XX:InitiatingHeapOccupancyPercent=45
```

### ZGC Tuning

ZGC is designed to require **minimal tuning**. Usually you just set the heap size:

```bash
java -XX:+UseZGC -Xmx4g -jar myapp.jar
# That's it. ZGC handles the rest.
```

The one thing ZGC really needs is **headroom**: it collects while your application keeps allocating, so the heap must be large enough to absorb allocations during a cycle. If you see `Allocation Stall` in the logs, give it more heap (or reduce the allocation rate). `-XX:SoftMaxHeapSize` lets you ask ZGC to *try* to stay below a size while keeping `-Xmx` as an emergency reserve.

## Running in Containers

Most JVMs today run in containers, and that's where the defaults matter most. The JVM has been **container-aware** since Java 10 (`-XX:+UseContainerSupport`, on by default): it reads the container's CPU and memory limits (cgroups v1 and v2) rather than the host's.

From those limits it derives:

- **Heap size**: by default, the maximum heap is 25% of the container's memory limit (`MaxRAMPercentage`). That's conservative for a container whose only job is to run your JVM; 50–75% is common, leaving room for metaspace, thread stacks, direct buffers and the GC's own data structures.
- **GC and compiler threads**, from the CPU limit.
- **Which collector to use**, and this changed recently.

> [!IMPORTANT]
> **Java 27 changed the default GC in small containers.** Up to Java 26, a JVM that saw **a single CPU or less than 1792 MB of memory** considered itself a "client-class" machine and silently picked **Serial GC**. Since Java 27 (JEP 523), it picks **G1** everywhere.
>
> For most services this is an improvement (shorter pauses, better throughput thanks to G1's recent work). But if you run many tiny JVMs, G1 uses a few more threads and a little more native memory than Serial, so check your memory headroom after upgrading. If you prefer the old behaviour, just say so: `-XX:+UseSerialGC`. An explicitly chosen collector always wins.

A good habit is to **choose the collector explicitly** in production, so an upgrade or a change of container size never changes it behind your back. To see what the JVM actually picked:

```bash
java -Xlog:gc -version
# [0.004s][info][gc] Using G1

# Or ask a running JVM
jcmd <pid> VM.flags | tr ' ' '\n' | grep -E 'Use.*GC'
```

A typical container setup:

```bash
java -XX:MaxRAMPercentage=75 \
     -XX:+UseG1GC \
     -Xlog:gc*:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=20m \
     -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/dumps \
     -jar myservice.jar
```

> [!NOTE]
> Upgrading to Java 27 also turns on **compact object headers** ([Chapter 8](08-object-layout.md)), which typically shrinks the live set noticeably. If you compare heap graphs across the upgrade, don't be surprised to see *less* memory used for the same traffic.

## GC Logging

This is your most important diagnostic tool. Since Java 9, GC logging goes through **unified logging** (`-Xlog`):

```bash
# Basic: one line per GC
java -Xlog:gc -jar myapp.jar

# Detailed, to a file (recommended for analysis)
java -Xlog:gc*:file=gc.log:time,uptime,level,tags -jar myapp.jar

# Same, with rotation: 5 files of 20 MB
java -Xlog:gc*:file=gc.log:time,uptime,level,tags:filecount=5,filesize=20m -jar myapp.jar

# Safepoint information (time-to-safepoint problems, see Chapter 9)
java -Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags -jar myapp.jar
```

The syntax is `-Xlog:<tags>:<output>:<decorations>:<output-options>`. You can even turn logging on in a running JVM, without a restart:

```bash
jcmd <pid> VM.log output=gc.log what=gc*
```

> [!TIP]
> In a shell, quote the `-Xlog` argument (`'-Xlog:gc*:file=gc.log'`) or `zsh` will try to expand the `*`.

The old pre-Java 9 flags (`-XX:+PrintGCDetails`, `-XX:+PrintGCDateStamps`, `-Xloggc:gc.log`) are either deprecated aliases for `-Xlog` or gone entirely; don't use them.

### Reading a GC Log

With `-Xlog:gc`, each collection is one line:

```text
[0.004s][info][gc] Using G1
[0.033s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 48M->2M(256M) 1.194ms
[0.048s][info][gc] GC(1) Pause Young (Normal) (G1 Evacuation Pause) 119M->4M(256M) 1.198ms
[0.067s][info][gc] GC(2) Pause Young (Normal) (G1 Evacuation Pause) 153M->5M(256M) 1.213ms
```

With `-Xlog:gc*`, you get the details of each one. Here's a G1 young collection (JDK 25, trimmed a little):

```text
[2026-09-24T14:52:32.792+0200][0.093s][info][gc,start    ] GC(3) Pause Young (Normal) (G1 Evacuation Pause)
[2026-09-24T14:52:32.792+0200][0.093s][info][gc,task     ] GC(3) Using 6 workers of 8 for evacuation
[2026-09-24T14:52:32.793+0200][0.094s][info][gc,phases   ] GC(3)   Evacuate Collection Set: 0.68ms
[2026-09-24T14:52:32.793+0200][0.094s][info][gc,heap     ] GC(3) Eden regions: 148->0(148)
[2026-09-24T14:52:32.793+0200][0.094s][info][gc,heap     ] GC(3) Survivor regions: 5->5(20)
[2026-09-24T14:52:32.793+0200][0.094s][info][gc,heap     ] GC(3) Old regions: 2->2
[2026-09-24T14:52:32.793+0200][0.094s][info][gc,heap     ] GC(3) Humongous regions: 0->0
[2026-09-24T14:52:32.793+0200][0.094s][info][gc          ] GC(3) Pause Young (Normal) (G1 Evacuation Pause) 153M->5M(256M) 1.018ms
```

Reading this:

- **GC(3)**: the fourth GC event (numbering starts at 0)
- **Pause Young (Normal)**: a regular young-generation collection, triggered because Eden was full (**G1 Evacuation Pause**)
- **Using 6 workers of 8**: G1 ran the pause with 6 parallel threads
- **Eden regions: 148→0(148)**: 148 Eden regions collected and emptied; the number in parentheses is the target for the next cycle
- **Survivor regions: 5→5(20)**: survivors stayed at 5 regions (of up to 20)
- **Old regions: 2→2**: nothing was promoted this time
- **153M→5M(256M)**: heap usage went from 153 MB to 5 MB, out of 256 MB committed
- **1.018ms**: the pause lasted about 1 millisecond

And the same for ZGC, where each cycle is a *minor* (young) or *major* (young + old) collection that runs mostly concurrently:

```text
[0.034s][info][gc] GC(0) Major Collection (Warmup)
[0.037s][info][gc] GC(0) Major Collection (Warmup) 26M(10%)->26M(10%) 0.003s
[0.060s][info][gc] GC(3) Minor Collection (Allocation Rate)
```

Note that for ZGC the time at the end is the length of the whole (mostly concurrent) cycle, not a pause. The actual pauses appear in the `-Xlog:gc*` output as `Pause Mark Start`, `Pause Mark End` and `Pause Relocate Start`, typically a few *micro*seconds each.

### GC Log Visualization Tools

Don't read big logs by hand; use tools:

| Tool                                 | Description                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| **GCViewer**                         | Open source; throughput, pause times and heap usage graphs from a GC log            |
| **GCEasy**                           | Online service: upload a log, get analysis and recommendations                      |
| **JDK Flight Recorder + Mission Control** | GC events, allocation profiling and much more from a JFR recording (see [Chapter 21](../part-6-performance/21-monitoring.md)) |
| **Eclipse MAT**                      | Heap dump analysis (for leaks, not GC logs)                                         |

## The Three Metrics That Matter

When tuning GC, you're balancing three competing goals.

### 1. Throughput

The percentage of time your application spends doing *actual work* (not GC).

```text
Throughput = (Total time - GC time) / Total time × 100%

Example: application ran for 100 seconds, GC took 3 seconds in total.
Throughput = 97%
```

For concurrent collectors, remember that "GC time" also includes the CPU their background threads take away from your application, not just pauses.

### 2. Latency (Pause Time)

The duration of individual GC pauses, usually looked at as p50, p99, and max.

For a web service, reasonable targets with G1 might be:

- p50 pause: < 10 ms
- p99 pause: < 50 ms
- Max pause: < 200 ms

With ZGC or Shenandoah, pauses are usually far below a millisecond, and the question becomes "does the GC keep up?" rather than "how long are the pauses?".

### 3. Footprint

Total memory consumed by the JVM process: heap + metaspace + code cache + thread stacks + GC data structures + direct buffers.

In containers, this is constrained by your memory limit, and exceeding it gets the process **OOM-killed** by the kernel, with no `OutOfMemoryError` and no heap dump. Leave room above `-Xmx`.

> **The trilemma**: you can optimise for any two of these, but improving one often costs you another:
> - More heap → fewer GCs → better throughput, but larger footprint
> - Low-pause GC (ZGC) → better latency, but more CPU and headroom → slightly lower throughput, larger footprint
> - Smaller heap → less footprint, but more frequent GC → lower throughput

## Common Problems and Solutions

### Problem: Frequent Full GCs

**Symptom**: the GC log shows `Pause Full` events regularly.

**Diagnosis**:

```bash
grep "Pause Full" gc.log
```

**Likely causes**:

1. **Heap too small** → increase `-Xmx` (or `MaxRAMPercentage`)
2. **Memory leak** → take a heap dump and analyse it with Eclipse MAT
3. **Humongous allocations** (G1) → large arrays filling the heap; see the case study below
4. **Concurrent marking starts too late** → G1 normally adapts, but a very spiky allocation rate can outrun it

### Problem: Long GC Pauses

**Symptom**: individual pauses exceed your target.

**Solutions**:

- Switch to **ZGC** (or generational Shenandoah) for sub-millisecond pauses
- With G1: lower `-XX:MaxGCPauseMillis` (G1 will collect less per pause, which may mean more frequent pauses)
- Reduce the allocation rate (less garbage = fewer and shorter GCs)
- Check that the pause is really GC work and not **time-to-safepoint** (`-Xlog:safepoint`)

### Problem: `OutOfMemoryError: Java heap space`

**Cause**: the heap is full and the GC can't free enough.

**Solutions**:

1. Increase `-Xmx` (if it's genuinely too small)
2. Find the leak: capture a heap dump and analyse it
   ```bash
   # Capture a heap dump on OOM (use this in production, always)
   java -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp/heapdump.hprof -jar myapp.jar
   ```
3. Profile allocations with JFR or async-profiler

### Problem: `OutOfMemoryError: Metaspace`

**Cause**: too many classes loaded (heavy runtime code generation, dynamic proxies, or class loader leaks after redeployments).

**Solution**:

```bash
# Increase the metaspace limit
java -XX:MaxMetaspaceSize=512m -jar myapp.jar
```

Or, better, investigate *why* so many classes are being loaded (`jcmd <pid> VM.classloader_stats`).

## Scala-Specific GC Considerations

### Immutable Data and Allocation Pressure

Scala's functional style creates many short-lived objects:

```scala
// Each operation creates an intermediate collection
val result = data
  .filter(_.isActive)      // New collection
  .map(_.transform())      // New collection
  .flatMap(_.children)     // New collection
  .take(10)                // New collection
  .toList                  // New collection
```

**Mitigations**:

- Use **lazy views** to avoid intermediate collections:
  ```scala
  val result = data.view
    .filter(_.isActive)
    .map(_.transform())
    .flatMap(_.children)
    .take(10)
    .toList  // Only ONE collection materialised
  ```
- Use `Iterator` for truly lazy one-pass processing
- Don't over-worry: the young generation handles this pattern very well, since most of these intermediates die in Eden. Measure the allocation rate before rewriting idiomatic code.

### Cats Effect / ZIO and GC

Effect systems allocate many small `IO` / `ZIO` objects and fiber data structures. This is fine for a generational GC. However:

- **Huge fiber counts** (millions) can fill Eden quickly → frequent minor GCs
- **Long-lived fibers** holding references can promote objects unnecessarily
- **Effect runtime thread pools** are sized from the CPU count, and so are the GC's threads; in a container with a small CPU limit, both compete for the same cores

### `lazy val` and Locking

In Scala 2, a `lazy val` is initialised inside a `synchronized` block (double-checked locking). Scala 3 uses a lock-free, CAS-based scheme (and since Scala 3.8 it no longer relies on `sun.misc.Unsafe`). Either way, heavily contended initialisation shows up as lock contention in profiles, not as GC time. If profiling shows `lazy val` initialisation as a bottleneck, consider eager initialisation.

## Example: Diagnosing a GC Issue

Let's walk through a realistic scenario.

**Situation**: your Scala web service, on G1 with a 256 MB heap, has a p99 latency of 500 ms. The target is 100 ms.

**Step 1**: enable GC logging

```bash
java '-Xlog:gc*:file=gc.log:time,uptime,level,tags' -Xmx256m -jar myservice.jar
```

**Step 2**: look at the pause causes (or load the log into GCViewer / GCEasy):

```bash
grep '\[gc *\]' gc.log | grep -oE 'Pause [A-Za-z]+( \([^)]*\))+' | sort | uniq -c | sort -rn
```

```text
 315 Pause Young (Normal) (G1 Humongous Allocation)
 133 Pause Young (Concurrent Start) (G1 Humongous Allocation)
   3 Pause Full (G1 Compaction Pause)
```

**Step 3**: almost every collection is triggered by a **humongous allocation**, and G1 occasionally gives up and runs a **full GC**. Those full GCs are our latency spikes. The `gc,heap` lines confirm it: the "Humongous regions" count keeps growing between collections.

**Step 4**: find the large allocations. A short JFR recording tells you where they come from:

```bash
java -XX:StartFlightRecording=filename=rec.jfr,settings=profile -jar myservice.jar
jfr view allocation-by-site rec.jfr
```

It turns out a serialisation buffer is allocated as a fresh 4 MB `byte[]` for every request. With a 256 MB heap, G1's region size is 1 MB, so anything from 512 KB up is humongous.

**Step 5**: fix. Options, from best to worst:

1. Fix the code: reuse or pool the buffer, or stream instead of buffering the whole payload
2. Increase the region size so the buffers are no longer humongous: `-XX:G1HeapRegionSize=16m` (the threshold becomes 8 MB, though on such a small heap that leaves G1 only 16 regions to work with); a larger heap helps too, since the default region size grows with it
3. Switch to ZGC (`-XX:+UseZGC`), which handles large objects without G1's humongous-region special case, at the cost of needing more heap headroom

**Result**: after reusing the buffer, the full GCs disappear, the young pauses drop back to a couple of milliseconds, and p99 latency falls to 45 ms. Problem solved, and without a single exotic GC flag.

<div class="takeaways">

## Key Takeaways

- **Measure first, tune second.** Enable GC logging (`-Xlog:gc*`) before changing anything, and start from the defaults
- **In containers**, the JVM reads your limits: the default max heap is 25% of the memory limit; raise `MaxRAMPercentage` and leave room for non-heap memory
- **Java 27 picks G1 even in small containers** (it used to pick Serial below 2 CPUs / 1792 MB); choose your collector explicitly to avoid surprises
- `-XX:+UseZGC` alone means generational ZGC; `-XX:+ZGenerational` is obsolete. Generational Shenandoah is `-XX:ShenandoahGCMode=generational`
- G1's `MaxGCPauseMillis` is a **target**, not a guarantee; ZGC needs almost no tuning beyond heap size and headroom
- The three metrics: **throughput**, **latency**, **footprint**; you can't max out all three
- Use **`-XX:+HeapDumpOnOutOfMemoryError`** in production, always
- Humongous allocations are the classic G1 trap; JFR shows you where they come from
- Scala's functional style creates garbage the young generation handles well; use **views** and **iterators** where profiling says it matters

</div>
