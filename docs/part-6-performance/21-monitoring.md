# Chapter 21 — Monitoring and Diagnostics

## The Diagnostic Toolbox

The JVM comes with an impressive set of built-in tools. You don't need to install anything special: the JDK includes what you need to diagnose performance issues, memory leaks, thread problems, and more. On top of that sits one third-party tool almost everyone uses, async-profiler.

```text
What's wrong?
│
├── High CPU / slow code ─────────▶ JFR, async-profiler, flame graphs
│
├── Memory keeps growing ─────────▶ Heap dump + Eclipse MAT,
│                                   JFR old-object samples
│
├── Requests stuck / deadlock ────▶ Thread dumps:
│                                   jcmd Thread.print / dump_to_file
│
├── Long GC pauses ───────────────▶ GC logs, JFR GC views
│
└── Process RSS bigger than heap ─▶ Native Memory Tracking
```

## `jcmd`: The Swiss Army Knife

`jcmd` is the one tool to learn first. It talks to a running JVM and exposes almost every diagnostic command, and it replaces most of the older single-purpose tools (`jstack`, `jmap`, `jinfo`).

```bash
# List running JVMs (like jps)
jcmd

# List the commands this JVM supports
jcmd <pid> help
jcmd <pid> help Thread.dump_to_file     # details for one command

# Threads
jcmd <pid> Thread.print                  # thread dump (like jstack)

# Heap
jcmd <pid> GC.heap_info                  # heap layout and usage
jcmd <pid> GC.class_histogram            # objects per class (like jmap -histo)
jcmd <pid> GC.heap_dump /tmp/heap.hprof  # heap dump

# JIT
jcmd <pid> Compiler.codecache            # code cache usage

# JFR
jcmd <pid> JFR.start duration=60s filename=recording.jfr
jcmd <pid> JFR.view hot-methods          # summary view of a running recording

# VM
jcmd <pid> VM.flags                      # effective JVM flags
jcmd <pid> VM.system_properties
jcmd <pid> VM.native_memory summary      # needs -XX:NativeMemoryTracking, see below
```

The older tools still work, and you'll see them in many blog posts:

| Tool     | What it does                          | `jcmd` equivalent             |
| -------- | ------------------------------------- | ----------------------------- |
| `jps -l` | List JVM processes                    | `jcmd`                        |
| `jstack` | Thread dump                           | `jcmd <pid> Thread.print`     |
| `jmap`   | Histogram, heap dump                  | `GC.class_histogram`, `GC.heap_dump` |
| `jstat`  | GC statistics over time               | (none: `jstat` is still handy) |

### Reading a Thread Dump

Thread dumps print every thread's stack trace and state. They are essential for diagnosing:
- **Deadlocks**: the dump detects and reports them at the end
- **Blocked threads**: which thread holds the lock?
- **CPU-spinning threads**: what code is running?
- **Thread leaks**: too many threads?

```text
"http-handler-1" #12 daemon prio=5 os_prio=0 tid=0x00007f... nid=0x1a03
   java.lang.Thread.State: WAITING (parking)
        at jdk.internal.misc.Unsafe.park(Native Method)
        - parking to wait for <0x000000076b> (a j.u.c.l.AbstractQueuedSynchronizer...)
        at j.u.c.locks.LockSupport.park(LockSupport.java:211)
        at j.u.c.locks.AbstractQueuedSynchronizer.acquire(...)
        at com.example.DatabasePool.getConnection(DatabasePool.scala:42)
        at com.example.UserService.findUser(UserService.scala:18)
```

> [!TIP]
> Take three thread dumps a few seconds apart. Compare them to see which threads are stuck and which are making progress.

### Thread Dumps with Virtual Threads

`Thread.print` (and `jstack`) only shows **platform threads**. A virtual thread shows up only while it's mounted on a carrier, and a million parked virtual threads would be unreadable in that format anyway. For applications using virtual threads ([Chapter 18](../part-5-concurrency/18-virtual-threads.md)), use the newer command, which includes virtual threads and can write JSON:

```bash
jcmd <pid> Thread.dump_to_file -format=json /tmp/threads.json
```

The JSON groups threads by **thread container** (for example, the scope of a `StructuredTaskScope` or an executor), so you can see which tasks belong to which request:

```json
{
  "threadDump": {
    "processId": "68203",
    "runtimeVersion": "25.0.4.1+1-LTS",
    "threadContainers": [
      {
        "container": "<root>",
        "threads": [
          { "tid": "3", "name": "main", "state": "TIMED_WAITING", "stack": [ "..." ] }
        ]
      }
    ]
  }
}
```

### `jstat`: GC Statistics Over Time

```bash
# GC stats, refreshed every second
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

For real GC analysis, prefer GC logs (`-Xlog:gc*:file=gc.log`, see [Chapter 11](../part-3-memory-and-gc/11-gc-tuning.md)) or JFR.

## Java Flight Recorder (JFR)

**JFR** is an event recorder built into the JVM. It records events with **low overhead** (the default configuration targets around 1%) and is designed to be left on in production.

### What JFR Records

- GC events (pauses, phases, heap summaries, allocation samples)
- Thread events (sleep, park, lock contention, virtual thread pinning)
- I/O events (file and socket reads/writes)
- JIT compilation and deoptimization events
- Method profiling (execution samples)
- Exceptions, class loading, CPU load, container metrics
- Your own events (subclass `jdk.jfr.Event`)

### Starting a Recording

```bash
# From the command line at startup
java -XX:StartFlightRecording=duration=60s,filename=myapp.jfr -jar myapp.jar

# Attach to a running process
jcmd <pid> JFR.start duration=60s filename=myapp.jfr

# Use the more detailed "profile" settings (more events, a bit more overhead)
java -XX:StartFlightRecording=settings=profile,filename=myapp.jfr -jar myapp.jar
```

### JFR in Production: Always On

Run a continuous recording into a ring buffer, and dump it when something goes wrong:

```bash
java -XX:StartFlightRecording=disk=true,maxage=6h,maxsize=1g,dumponexit=true,filename=app.jfr \
     -jar myapp.jar

# Later, when an incident happens:
jcmd <pid> JFR.dump filename=/tmp/incident.jfr
```

When an issue occurs, you already have the recording. No need to reproduce.

### Analyzing Recordings

Open `.jfr` files with:
- **JDK Mission Control (JMC)**: the official GUI, excellent for exploring recordings
- **IntelliJ IDEA**: built-in JFR viewer and flame graphs
- **`jfr` CLI**: fast, scriptable, and available wherever the JDK is

The `jfr view` command (JDK 21+) turns a recording into readable tables, with dozens of predefined views:

```bash
jfr summary myapp.jfr                     # which events, how many
jfr view hot-methods myapp.jfr            # where CPU samples land
jfr view gc-pauses myapp.jfr              # GC pause statistics
jfr view allocation-by-site myapp.jfr     # who allocates the most
jfr view contention-by-site myapp.jfr     # lock contention
jfr view pinned-threads myapp.jfr         # virtual threads that pinned their carrier
jfr print --events jdk.GCPhasePause myapp.jfr   # raw events
```

Run `jfr help view` for the full list.

### What's New in JFR (JDK 25–27)

JFR gained several features recently that make it a much more complete profiler.

#### CPU-Time Profiling <span class="since">Java 25</span> <span class="preview">Experimental, Linux</span>

JFR's classic execution sampler takes a sample every few milliseconds of *wall-clock* time, looking only at threads that are running Java code at that instant. [JEP 509](https://openjdk.org/jeps/509) adds real **CPU-time sampling** on Linux, using the kernel's CPU timers, so each sample represents a slice of CPU actually consumed (including time spent in native code). The new event is `jdk.CPUTimeSample`:

```bash
java -XX:StartFlightRecording=jdk.CPUTimeSample#enabled=true,filename=profile.jfr -jar myapp.jar
jfr view cpu-time-hot-methods profile.jfr
```

Its rate is set with a `throttle` setting, either as a CPU period per thread (`throttle=10ms`) or as a total rate (`throttle=500/s`, the default).

#### Cooperative Sampling <span class="since">Java 25</span>

[JEP 518](https://openjdk.org/jeps/518) changes *how* JFR walks stacks, with no new flags. Before, the sampler suspended a thread and parsed its stack wherever it happened to be, which required fragile heuristics. Now the sampler records the thread's program counter and stack pointer, and the thread itself reconstructs the stack trace at its next safepoint. It's more robust, and because the recorded position is the one from the moment of the sample, it largely avoids the classic *safepoint bias*.

#### Method Timing and Tracing <span class="since">Java 25</span>

[JEP 520](https://openjdk.org/jeps/520) lets JFR instrument specific methods (by bytecode instrumentation) without an agent or code changes, with two options: `method-timing` (invocation counts and times) and `method-trace` (an event with a stack trace for every call). Filters name a method (`class::method`), all methods of a class, or all methods with an annotation (`@annotation`), separated by `;`:

```bash
# How long do static initializers take at startup?
java '-XX:StartFlightRecording:method-timing=::<clinit>,filename=clinit.jfr' -jar myapp.jar
jfr view method-timing clinit.jfr

# Who triggers HashMap resizes?
java '-XX:StartFlightRecording:jdk.MethodTrace#filter=java.util.HashMap::resize,filename=rec.jfr' -jar myapp.jar
jfr print --events jdk.MethodTrace --stack-depth 20 rec.jfr

# Time every JAX-RS GET endpoint of a running app
jcmd <pid> JFR.start method-timing=@jakarta.ws.rs.GET
```

Use it for a handful of methods at a time: instrumenting broad filters costs real overhead.

#### In-Process Data Redaction <span class="since">Java 27</span>

Recordings contain the JVM's command line, environment variables, and system properties, which often include secrets. With [JEP 536](https://openjdk.org/jeps/536), JFR now **redacts** them before they're written: values whose keys match patterns such as `*password*`, `*token*`, or `*secret*` appear as `[REDACTED]`. Redaction is on by default and configurable through `-XX:FlightRecorderOptions`:

```bash
# Add your own patterns (keys, and glob patterns for arguments)
java -XX:FlightRecorderOptions:'redact-key=confidential,redact-argument=https://*:*@*' -jar myapp.jar
```

> [!NOTE]
> Redaction covers the command line, environment variables, and system properties. It doesn't scan your application's own data: strings in custom events or exception messages are recorded as they are.

## async-profiler: Flame Graphs

[async-profiler](https://github.com/async-profiler/async-profiler) (currently in its 4.x series) is the go-to third-party profiler for JVM applications. It's a native agent that samples threads using OS facilities (`perf_events` and timers on Linux), so it sees **Java, native, JVM-internal, and kernel frames** in one stack, and it's not tied to safepoints. It produces flame graphs directly, and can also write JFR files.

### CPU Profiling

```bash
# Profile for 30 seconds, write an interactive flame graph
asprof -d 30 -f flamegraph.html <pid>
```

This produces an interactive **flame graph**, a visualization where:
- The x-axis represents the proportion of samples (not time order!)
- Each bar is a method on the call stack, with its callers below it
- Wider bars = more CPU time in that method (and its callees)
- You can click to zoom into a subtree

```text
|                    +---- com.example.process() -------------+
|            +------ Service.handle() ----------------------------------+
|     +----- HttpServer.serve() ---------------------------------------------+
| +-- Main.main() -------------------------------------------------------------+
+------------------------------------------------------------------------------+
```

### Allocation Profiling

```bash
asprof -d 30 -e alloc -f alloc-flamegraph.html <pid>
```

Shows which code paths allocate the most memory. Essential for reducing GC pressure.

> **For Scala**: Allocation flame graphs are incredibly useful for finding where boxing happens, where unnecessary intermediate collections are created, and where closures allocate.

### Wall-Clock Profiling

```bash
# Includes threads that are waiting or sleeping
asprof -d 30 -e wall -f wall-flamegraph.html <pid>
```

Shows where threads spend their time, including I/O and lock waits. Useful for latency problems where the CPU is mostly idle.

### Profiling a Section of a Run

```bash
asprof start <pid>
# ... run your tests or your load scenario ...
asprof stop -f profile.html <pid>
```

## Heap Dumps

When you suspect a memory leak, take a heap dump, a snapshot of every object on the heap:

```bash
# Manual dump
jcmd <pid> GC.heap_dump /tmp/heapdump.hprof

# Auto-dump on OOM (always enable this in production!)
java -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp/ -jar myapp.jar
```

> [!WARNING]
> A heap dump pauses the application and writes a file as large as the live heap. It also contains every secret in memory (passwords, tokens, personal data). Treat `.hprof` files as sensitive.

### Analyzing Heap Dumps

**Eclipse MAT (Memory Analyzer Tool)** is the standard:

1. Open the `.hprof` file
2. **Dominator Tree**: shows which objects retain the most memory
3. **Leak Suspects Report**: auto-detects potential memory leaks
4. **Histogram**: object counts by class
5. **OQL (Object Query Language)**: query the heap like a database

```sql
-- OQL: Strings whose backing array is larger than 1000 bytes
SELECT s FROM java.lang.String s WHERE s.value.@length > 1000
```

The class histogram gives a quick first look without a full dump:

```text
 num     #instances         #bytes  class name
   1:       1234567       98765432  [B (byte arrays)
   2:        987654       47654321  java.lang.String
   3:        567890       27259920  scala.collection.immutable.$colon$colon
   4:        456789       21926472  com.example.Event
```

Common memory leak patterns:
- **Growing collections**: a `HashMap` that only gets `put()`, never `remove()`
- **Event listeners**: registered but never unregistered
- **Thread-locals**: retained by pool threads that live forever
- **Class loader leaks**: in application servers or tools with hot reloading (sbt's `~run` included)
- **Closures capturing too much**: a lambda that captures `this` when it only needs one field

> **Scala-specific**: Watch for accidental closure captures:
> ```scala
> class HeavyService(data: Array[Byte]) { // 100 MB!
>   def process(items: List[Int]): List[Int] =
>     items.map(x => x + 1)  // Does this lambda capture 'this'?
>     // In this case, no: the lambda only uses 'x'. But if it
>     // referenced any field of HeavyService, it would capture 'this',
>     // keeping the entire 100 MB alive as long as the lambda exists.
> }
> ```

For leaks you can't reproduce on demand, JFR's `OldObjectSample` event tracks a sample of long-lived objects. It's on in the default settings, but only the `profile` settings record the allocation stack traces that make `jfr view memory-leaks-by-site` useful.

## Native Memory Tracking

Sometimes the container gets OOM-killed while the heap looks fine. The JVM also uses **native memory**: metaspace, thread stacks, the code cache, GC data structures, direct buffers, and memory allocated by native libraries. **Native Memory Tracking (NMT)** breaks the JVM's own share down by category:

```bash
# Enable at startup (summary has low overhead; detail costs more)
java -XX:NativeMemoryTracking=summary -jar myapp.jar

jcmd <pid> VM.native_memory summary scale=MB

# Find what grows over time
jcmd <pid> VM.native_memory baseline
# ... wait ...
jcmd <pid> VM.native_memory summary.diff scale=MB
```

```text
Total: reserved=5616MB, committed=350MB
-                 Java Heap (reserved=4096MB, committed=258MB)
-                     Class (reserved=1024MB, committed=1MB)
                            (classes #2831)
-                    Thread (reserved=36MB, committed=0MB)
                            (threads #18)
...
```

Look at *committed* memory: that's what actually counts against the container limit. NMT only sees memory the JVM itself allocates; memory `malloc`ed by a native library (a JNI or FFM library, for instance) won't appear in its categories.

## JMX (Java Management Extensions)

JMX exposes management and monitoring information through **MBeans** (Managed Beans), locally or remotely:

```bash
# Enable remote JMX (local testing only: no authentication, no TLS!)
java -Dcom.sun.management.jmxremote.port=9999 \
     -Dcom.sun.management.jmxremote.authenticate=false \
     -Dcom.sun.management.jmxremote.ssl=false \
     -jar myapp.jar
```

> [!CAUTION]
> Never expose an unauthenticated JMX port outside your machine: JMX can be used to run arbitrary code in the JVM.

Tools that connect via JMX:
- **JDK Mission Control** and **VisualVM**: live threads, heap, CPU, GC
- **JConsole**: simpler GUI, bundled with the JDK
- **Prometheus JMX Exporter**: exports JMX metrics to Prometheus

In practice, most services today export metrics through a library (Micrometer, OpenTelemetry, or Kamon on the Scala side), which read the same JVM MBeans and publish them to your monitoring system.

## Quick Reference: Which Tool When?

| Problem                          | Tool                                        |
| -------------------------------- | ------------------------------------------- |
| Which JVM processes are running? | `jcmd` (or `jps`)                           |
| Threads stuck / deadlocked       | `jcmd Thread.print`                         |
| Same, with virtual threads       | `jcmd Thread.dump_to_file -format=json`     |
| High CPU usage                   | async-profiler (CPU), JFR (CPU-time on Linux) |
| Slow method / hot path           | Flame graph; JFR method timing              |
| Memory growing / leak suspected  | Heap dump + Eclipse MAT, JFR leak views     |
| High allocation rate             | async-profiler alloc mode, JFR              |
| GC pauses too long               | GC logs, `jfr view gc-pauses`               |
| RSS bigger than heap             | Native Memory Tracking                      |
| I/O or lock waits                | async-profiler wall mode, JFR               |
| General production monitoring    | JFR (always on) + metrics                   |

<div class="takeaways">

## Key Takeaways

- **`jcmd`** is the one diagnostic tool to know: threads, heap, JIT, JFR, flags, native memory
- Use **`jcmd <pid> Thread.dump_to_file -format=json`** for apps with virtual threads; `Thread.print` doesn't show them
- **JFR** is the production recorder: low overhead, always on, and `jfr view` makes it readable from the terminal
- JDK 25 added **CPU-time profiling** (experimental, Linux), **cooperative sampling**, and **method timing and tracing** to JFR; JDK 27 **redacts secrets** from recordings by default
- **async-profiler** produces **flame graphs** covering Java, native, and kernel frames
- **Heap dumps** + Eclipse MAT for leaks; always enable **`-XX:+HeapDumpOnOutOfMemoryError`**
- **Native Memory Tracking** explains memory that isn't heap
- For Scala: allocation flame graphs reveal boxing, intermediate collections, and closure captures

</div>
