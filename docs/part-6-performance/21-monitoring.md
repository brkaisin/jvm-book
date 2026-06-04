# Chapter 21 — Monitoring and Diagnostics

[← Previous: GraalVM](20-graalvm.md) · [Next: Performance Pitfalls →](22-performance-pitfalls.md)

---

## The Diagnostic Toolbox

The JVM comes with an impressive set of built-in tools. You don't need to install anything special — the JDK includes everything you need to diagnose performance issues, memory leaks, thread problems, and more.

## Command-Line Tools

### `jps` — List JVM Processes

```bash
$ jps -l
12345 com.example.MyApp
12346 sbt.boot.SbtMain
12347 jdk.jcmd/sun.tools.jps.Jps
```

Shows all running JVM processes with their PIDs. The starting point for all diagnostics.

### `jstack` — Thread Dump

```bash
jstack <pid>
```

Prints every thread's stack trace and state. Essential for diagnosing:
- **Deadlocks** — jstack detects and reports them
- **Blocked threads** — which thread holds the lock?
- **CPU-spinning threads** — what code is running?
- **Thread leaks** — too many threads?

```
"http-handler-1" #12 daemon prio=5 os_prio=0 tid=0x00007f... nid=0x1a03
   java.lang.Thread.State: WAITING (parking)
        at jdk.internal.misc.Unsafe.park(Native Method)
        - parking to wait for <0x000000076b> (a j.u.c.l.AbstractQueuedSynchronizer...)
        at j.u.c.locks.LockSupport.park(LockSupport.java:211)
        at j.u.c.locks.AbstractQueuedSynchronizer.acquire(...)
        at com.example.DatabasePool.getConnection(DatabasePool.scala:42)
        at com.example.UserService.findUser(UserService.scala:18)
```

> **Tip**: Take 3 thread dumps 5 seconds apart. Compare them to see which threads are stuck vs. which are making progress.

### `jmap` — Memory Map

```bash
# Histogram of objects by class
jmap -histo <pid> | head -30

# Trigger a heap dump
jmap -dump:format=b,file=heapdump.hprof <pid>
```

The histogram shows which classes consume the most memory:

```
 num     #instances         #bytes  class name
   1:       1234567       98765432  [B (byte arrays)
   2:        987654       47654321  java.lang.String
   3:        567890       27259920  scala.collection.immutable.$colon$colon
   4:        456789       21926472  com.example.Event
```

### `jstat` — GC Statistics

```bash
# GC stats, refreshed every 1 second
jstat -gcutil <pid> 1000

  S0     S1     E      O      M     CCS    YGC     YGCT    FGC    FGCT     GCT
  0.00  78.43  45.21  67.89  95.12  91.45   142    1.234     3    0.456   1.690
```

| Column   | Meaning                            |
| -------- | ---------------------------------- |
| S0, S1   | Survivor space 0/1 utilization (%) |
| E        | Eden utilization (%)               |
| O        | Old generation utilization (%)     |
| M        | Metaspace utilization (%)          |
| YGC/YGCT | Young GC count/time                |
| FGC/FGCT | Full GC count/time                 |
| GCT      | Total GC time                      |

### `jcmd` — The Swiss Army Knife

`jcmd` is the modern replacement for many older tools:

```bash
# List available commands
jcmd <pid> help

# Thread dump (like jstack)
jcmd <pid> Thread.print

# Heap dump
jcmd <pid> GC.heap_dump /tmp/heapdump.hprof

# GC stats
jcmd <pid> GC.heap_info

# Class histogram (like jmap -histo)
jcmd <pid> GC.class_histogram

# Start JFR recording
jcmd <pid> JFR.start duration=60s filename=recording.jfr

# VM flags
jcmd <pid> VM.flags

# System properties
jcmd <pid> VM.system_properties
```

## Java Flight Recorder (JFR)

**JFR** is a profiling framework built into the JVM. It records events with **minimal overhead** (typically < 2%) and is safe to use in production.

### What JFR Records

- GC events (pauses, allocations, promotions)
- Thread events (sleep, park, contention)
- I/O events (file, socket reads/writes)
- JIT compilation events
- Method profiling (sampling)
- Exceptions thrown
- Class loading
- CPU usage

### Starting a JFR Recording

```bash
# From the command line at startup
java -XX:StartFlightRecording=duration=60s,filename=myapp.jfr -jar myapp.jar

# Or attach to a running process
jcmd <pid> JFR.start duration=60s filename=myapp.jfr

# Continuous recording (ring buffer)
java -XX:StartFlightRecording=disk=true,maxage=1h,maxsize=250m -jar myapp.jar
```

### Analyzing JFR Recordings

Open `.jfr` files with:
- **JDK Mission Control (JMC)** — The official GUI tool, excellent for exploring recordings
- **IntelliJ IDEA** — Built-in JFR viewer
- **`jfr` CLI tool** — Command-line analysis

```bash
# Print JFR events summary
jfr summary myapp.jfr

# Print specific event types
jfr print --events jdk.GCPhasePause myapp.jfr

# Print hot methods
jfr print --events jdk.ExecutionSample myapp.jfr
```

### JFR in Production

JFR is designed for production use. Enable it always:

```bash
java -XX:StartFlightRecording=disk=true,maxage=6h,maxsize=1g,dumponexit=true,filename=app.jfr -jar myapp.jar
```

When an issue occurs, you already have the recording. No need to reproduce.

## async-profiler: Flame Graphs

[async-profiler](https://github.com/async-profiler/async-profiler) is the go-to profiler for JVM applications. Unlike JFR's safepoint-based sampling, async-profiler uses **AsyncGetCallTrace** — it can sample at any point, not just safepoints. This gives more accurate results.

### CPU Profiling

```bash
# Profile for 30 seconds, output a flame graph
./asprof -d 30 -f flamegraph.html <pid>
```

This produces an interactive **flame graph** — a visualization where:
- The x-axis represents the proportion of samples (not time!)
- Each bar is a method on the call stack
- Wider bars = more CPU time in that method (and its callees)
- You can click to zoom into a subtree

```
│                    ┌──── com.example.process() ─────────────┐
│            ┌───── Service.handle() ──────────────────────────────┐
│     ┌──── HttpServer.serve() ────────────────────────────────────────┐
│ ┌── Main.main() ─────────────────────────────────────────────────────────┐
└──────────────────────────────────────────────────────────────────────────┘
```

### Allocation Profiling

```bash
# Profile allocations
./asprof -d 30 -e alloc -f alloc-flamegraph.html <pid>
```

Shows which code paths allocate the most objects. Essential for reducing GC pressure.

> **For Scala**: Allocation flame graphs are incredibly useful for finding where boxing happens, where unnecessary intermediate collections are created, and where closures allocate.

### Wall-Clock Profiling

```bash
# Profile wall-clock time (includes waiting/sleeping)
./asprof -d 30 -e wall -f wall-flamegraph.html <pid>
```

Shows where threads spend time, including I/O waits. Useful for finding I/O bottlenecks.

### Using with Scala/sbt

```bash
# Profile an sbt test run
./asprof start <pid>
# Run your tests
./asprof stop -f profile.html <pid>
```

## Heap Dumps

When you suspect a memory leak, take a heap dump — a snapshot of every object on the heap:

```bash
# Manual dump
jcmd <pid> GC.heap_dump /tmp/heapdump.hprof

# Auto-dump on OOM (always enable this in production!)
java -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp/ -jar myapp.jar
```

### Analyzing Heap Dumps

**Eclipse MAT (Memory Analyzer Tool)** is the standard:

1. Open the `.hprof` file
2. **Dominator Tree**: Shows which objects retain the most memory
3. **Leak Suspects Report**: Auto-detects potential memory leaks
4. **Histogram**: Object counts by class
5. **OQL (Object Query Language)**: Query the heap like a database

```sql
-- OQL: Find all Strings longer than 1000 characters
SELECT s FROM java.lang.String s WHERE s.value.length > 1000
```

Common memory leak patterns:
- **Growing collections**: A `HashMap` that only gets `put()`, never `remove()`
- **Event listeners**: Registered but never unregistered
- **Thread-locals**: Retained by thread pool threads (threads live forever)
- **Class loader leaks**: In application servers with hot reloading
- **Closures capturing too much**: A lambda that captures `this` when it only needs one field

> **Scala-specific**: Watch for accidental closure captures:
> ```scala
> class HeavyService(data: Array[Byte]) { // 100 MB!
>   def process(items: List[Int]): List[Int] =
>     items.map(x => x + 1)  // Does this lambda capture 'this'?
>     // In this case, no — the lambda only uses 'x'. But if it
>     // referenced any field of HeavyService, it would capture 'this',
>     // keeping the entire 100 MB alive as long as the lambda exists.
> }
> ```

## JMX (Java Management Extensions)

JMX exposes management and monitoring information through **MBeans** (Managed Beans). You can connect remotely:

```bash
# Enable JMX remote access
java -Dcom.sun.management.jmxremote \
     -Dcom.sun.management.jmxremote.port=9999 \
     -Dcom.sun.management.jmxremote.authenticate=false \
     -Dcom.sun.management.jmxremote.ssl=false \
     -jar myapp.jar
```

Tools that connect via JMX:
- **VisualVM** — GUI showing threads, heap, CPU, GC in real time
- **JConsole** — Simpler GUI, bundled with JDK
- **Prometheus JMX Exporter** — Export JMX metrics to Prometheus

## Quick Reference: Which Tool When?

| Problem                          | Tool                           |
| -------------------------------- | ------------------------------ |
| Which JVM processes are running? | `jps`                          |
| Threads are stuck / deadlocked   | `jstack`, `jcmd Thread.print`  |
| High CPU usage                   | async-profiler (CPU mode), JFR |
| Memory growing / leak suspected  | Heap dump + Eclipse MAT        |
| GC pauses too long               | GC logs + GCViewer, JFR        |
| Slow method / hot path           | async-profiler flame graph     |
| High allocation rate             | async-profiler alloc mode      |
| I/O bottleneck                   | async-profiler wall mode       |
| General production monitoring    | JFR (always on)                |
| Metrics dashboards               | JMX → Prometheus → Grafana     |

## Key Takeaways

- The JDK includes powerful tools: **jps, jstack, jmap, jstat, jcmd**
- **JFR** is the production profiler — always-on, < 2% overhead, records everything
- **async-profiler** produces **flame graphs** — the best way to visualize CPU and allocation hot spots
- **Heap dumps** + Eclipse MAT for memory leak investigation
- Always enable **`-XX:+HeapDumpOnOutOfMemoryError`** in production
- For Scala: allocation flame graphs reveal boxing, intermediate collections, and closure captures

---

[← Previous: GraalVM](20-graalvm.md) · [Next: Performance Pitfalls →](22-performance-pitfalls.md)
