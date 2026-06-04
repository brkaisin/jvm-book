# Chapter 11 — Tuning the GC

[← Previous: GC Tour](10-gc-tour.md) · [Next: Part IV — Type System →](../part-4-type-system/README.md)

---

## The Golden Rule of GC Tuning

Before we start: **measure, don't guess.** GC tuning without data is like optimizing code without profiling — you'll likely make things worse.

The process is:
1. Enable GC logging
2. Understand your workload's behavior
3. Pick the right collector
4. Adjust sizing
5. Measure the improvement
6. Repeat (or stop — good enough is good enough)

## Essential JVM Flags

### Heap Sizing

```bash
# Set initial and maximum heap
java -Xms2g -Xmx2g -jar myapp.jar

# For production: set them equal to avoid resize overhead
```

| Flag                   | Purpose                                               | Example                     |
| ---------------------- | ----------------------------------------------------- | --------------------------- |
| `-Xms`                 | Initial heap size                                     | `-Xms2g`                    |
| `-Xmx`                 | Maximum heap size                                     | `-Xmx2g`                    |
| `-Xmn`                 | Young generation size (G1 manages this automatically) | `-Xmn512m`                  |
| `-XX:MaxMetaspaceSize` | Cap metaspace growth                                  | `-XX:MaxMetaspaceSize=256m` |
| `-Xss`                 | Thread stack size                                     | `-Xss1m`                    |

### GC Selection

```bash
java -XX:+UseG1GC -jar myapp.jar           # G1 (default since Java 9)
java -XX:+UseZGC -jar myapp.jar            # ZGC
java -XX:+UseParallelGC -jar myapp.jar     # Parallel (throughput)
java -XX:+UseShenandoahGC -jar myapp.jar   # Shenandoah
java -XX:+UseSerialGC -jar myapp.jar       # Serial
```

### G1-Specific Tuning

```bash
# Target maximum pause time (milliseconds)
-XX:MaxGCPauseMillis=200

# Region size (auto-calculated, but can be set: 1, 2, 4, 8, 16, or 32 MB)
-XX:G1HeapRegionSize=4m

# Occupancy threshold to trigger mixed GC (% of heap)
-XX:InitiatingHeapOccupancyPercent=45
```

### ZGC Tuning

ZGC is designed to require **minimal tuning**. Usually you just set the heap size:

```bash
java -XX:+UseZGC -Xmx4g -jar myapp.jar
# That's it. ZGC handles the rest.
```

## GC Logging

This is your most important diagnostic tool. Since Java 9, use unified logging:

```bash
# Basic GC logging
java -Xlog:gc -jar myapp.jar

# Detailed GC logging (recommended for analysis)
java -Xlog:gc*:file=gc.log:time,uptime,level,tags -jar myapp.jar

# With decorations for timestamp and PID
java -Xlog:gc*:file=gc.log:time,pid,level -jar myapp.jar
```

Before Java 9 (legacy flags — don't use for new systems):
```bash
java -XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:gc.log -jar myapp.jar
```

### Reading a GC Log

Here's a G1 young collection log entry:

```
[2024-01-15T10:30:45.123+0000][info][gc] GC(42) Pause Young (Normal) (G1 Evacuation Pause)
[2024-01-15T10:30:45.123+0000][info][gc] GC(42)   Eden regions: 24->0(24)
[2024-01-15T10:30:45.123+0000][info][gc] GC(42)   Survivor regions: 3->3(3)
[2024-01-15T10:30:45.123+0000][info][gc] GC(42)   Old regions: 15->17
[2024-01-15T10:30:45.123+0000][info][gc] GC(42)   Humongous regions: 0->0
[2024-01-15T10:30:45.123+0000][info][gc] GC(42)   Heap: 168M(512M)->80M(512M)
[2024-01-15T10:30:45.128+0000][info][gc] GC(42) Pause Young (Normal) 5.234ms
```

Reading this:
- **GC(42)**: The 42nd GC event
- **Pause Young (Normal)**: A normal young generation collection
- **Eden 24→0**: 24 Eden regions collected, now 0 (all evacuated)
- **Survivor 3→3**: Survivors stayed at 3 regions
- **Old 15→17**: Old generation grew from 15 to 17 regions (promotions)
- **Heap 168M→80M(512M)**: Heap went from 168 MB used to 80 MB used (out of 512 MB total)
- **5.234ms**: The pause lasted 5.2 milliseconds

### GC Log Visualization Tools

Don't read raw logs — use tools:

| Tool                | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| **GCViewer**        | Open-source, shows throughput, pause times, heap usage graphs |
| **GCEasy**          | Online tool — upload a log, get analysis and recommendations  |
| **JClarity Censum** | Commercial, detailed analysis                                 |
| **Eclipse MAT**     | For heap dump analysis (not GC logs)                          |

## The Three Metrics That Matter

When tuning GC, you're balancing three competing goals:

### 1. Throughput
The percentage of time your application spends doing *actual work* (not GC).

```
Throughput = (Total time - GC time) / Total time × 100%

Example: Application ran for 100 seconds. GC took 3 seconds total.
Throughput = 97%
```

Anything above 95% is generally good. Below 90% suggests a problem.

### 2. Latency (Pause Time)
The duration of individual GC pauses. Usually measured at p50, p99, and max.

For a web service, typical targets:
- p50 pause: < 10 ms
- p99 pause: < 50 ms
- Max pause: < 200 ms

### 3. Footprint
Total memory consumed by the JVM (heap + metaspace + native memory + thread stacks + etc.).

In containerized environments, this is constrained by your memory limit. Exceeding it → OOM kill.

> **The trilemma**: You can optimize for any two of these, but improving one often comes at the cost of another:
> - More heap → fewer GCs → better throughput, but larger footprint
> - Low-pause GC (ZGC) → better latency, but more CPU overhead → slightly lower throughput
> - Smaller heap → less footprint, but more frequent GC → lower throughput

## Common Problems and Solutions

### Problem: Frequent Full GCs

**Symptom**: GC log shows `Pause Full` events frequently.

**Diagnosis**:
```bash
# Look for full GC events in the log
grep "Pause Full" gc.log
```

**Likely causes**:
1. **Heap too small** → Increase `-Xmx`
2. **Memory leak** → Take a heap dump and analyze with Eclipse MAT
3. **Humongous allocations** (G1) → Large objects forcing full GC. Increase `-XX:G1HeapRegionSize` or reduce object size
4. **Promotion rate too high** → Too many objects promoted to old gen. Increase young gen size

### Problem: Long GC Pauses

**Symptom**: Individual pauses exceed your target.

**Solutions**:
- Switch to **ZGC** for sub-millisecond pauses
- With G1: Lower `-XX:MaxGCPauseMillis` (but the GC might not achieve it)
- Reduce allocation rate (less garbage = fewer/shorter GCs)
- Ensure the heap isn't too large for the GC to handle (G1 with 64 GB+ can have long concurrent marking)

### Problem: `OutOfMemoryError: Java heap space`

**Cause**: Heap is full and GC can't free enough.

**Solutions**:
1. Increase `-Xmx` (if it's genuinely too small)
2. Find the leak: take a heap dump and analyze it
   ```bash
   # Capture heap dump on OOM
   java -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp/heapdump.hprof -jar myapp.jar
   ```
3. Profile memory usage with JFR or async-profiler

### Problem: `OutOfMemoryError: Metaspace`

**Cause**: Too many classes loaded (common with heavy reflection, dynamic proxy generation, or frequent redeployments in app servers).

**Solution**:
```bash
# Increase metaspace limit
java -XX:MaxMetaspaceSize=512m -jar myapp.jar
```

Or investigate *why* so many classes are being loaded.

## Scala-Specific GC Considerations

### Immutable Data and Allocation Pressure

Scala's functional style creates many short-lived objects:

```scala
// Each operation creates intermediate collections
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
    .toList  // Only ONE collection materialized
  ```
- Use `Iterator` for truly lazy one-pass processing
- The young generation GC handles this pattern well — most of these intermediates die in Eden

### Cats Effect / ZIO and GC

Effect systems allocate many small `IO` / `ZIO` objects (the fiber data structures). This is fine for the young generation GC. However:

- **Large actor/fiber counts** (millions) can fill Eden quickly → frequent minor GCs
- **Long-lived fibers** holding references can promote objects unnecessarily
- **ZIO/CE runtime thread pools** are tuned for the CPU count — the GC can benefit from the remaining cores

### `lazy val` and Locking

Scala's `lazy val` uses a synchronized block under the hood (double-checked locking in Scala 2, a more efficient scheme in Scala 3). In tight loops, this can interact with GC safepoints and lock contention. If profiling shows `lazy val` initialization as a bottleneck, consider eager initialization.

## Example: Diagnosing a GC Issue

Let's walk through a realistic scenario.

**Situation**: Your Scala web service has p99 latency of 500 ms. The target is 100 ms.

**Step 1**: Enable GC logging
```bash
java -Xlog:gc*:file=gc.log:time -Xmx2g -jar myservice.jar
```

**Step 2**: Analyze the log (using GCEasy or GCViewer)
```
Average GC pause: 15 ms
Max GC pause: 450 ms  ← Here's the problem
Full GC count: 3 in 1 hour
Full GC average pause: 420 ms
```

**Step 3**: The 450 ms pauses are full GCs. Let's see why:
```
[info][gc] GC(1042) Pause Full (G1 Humongous Allocation)
```

Humongous allocations! Large objects are triggering full GCs.

**Step 4**: Find the large allocations. With `-Xlog:gc+alloc=debug`:
```
Humongous object allocation: size=4194320, region size=2097152
```

A 4 MB object is being allocated. With G1's region size of 2 MB, anything > 1 MB is humongous.

**Step 5**: Fix. Options:
1. Increase region size: `-XX:G1HeapRegionSize=8m` (humongous threshold becomes 4 MB)
2. Find and fix the code allocating 4 MB objects (often large byte arrays or serialization buffers)
3. Switch to ZGC: `java -XX:+UseZGC -Xmx2g` (ZGC doesn't have the humongous object problem)

**Result**: After switching to ZGC, max GC pause dropped to 0.8 ms. P99 latency: 45 ms. Problem solved.

## Key Takeaways

- **Measure first, tune second.** Enable GC logging before changing anything.
- For production, set **`-Xms` equal to `-Xmx`** to avoid resize overhead
- G1's `MaxGCPauseMillis` is a **target**, not a guarantee
- ZGC needs almost **no tuning** — just set the heap size
- The three metrics: **throughput** (% time in app), **latency** (pause duration), **footprint** (memory)
- Use **`-XX:+HeapDumpOnOutOfMemoryError`** in production — always
- Scala's functional style creates GC pressure; use **views** and **iterators** to reduce intermediate allocations
- Visualize GC logs with tools (GCViewer, GCEasy) — don't read raw logs

---

[← Previous: GC Tour](10-gc-tour.md) · [Next: Part IV — Type System →](../part-4-type-system/README.md)
