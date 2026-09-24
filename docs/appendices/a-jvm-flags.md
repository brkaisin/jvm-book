# Appendix A — JVM Flags Cheat Sheet

This is a curated list of JVM flags you'll actually use, grouped by purpose, up to date for **JDK 27**. It is not exhaustive (HotSpot has well over 800 flags), but these are the ones that matter. When in doubt, check what your JVM actually uses:

```bash
java -XX:+PrintFlagsFinal -version | grep -E 'UseG1GC|MaxHeapSize|UseCompactObjectHeaders'
java -XX:+PrintCommandLineFlags -version     # the flags ergonomics picked for you
```

## Flag Syntax

```bash
-Xflag              # Non-standard (but universal) flags, e.g. -Xmx4g
-XX:+EnableFlag     # Boolean: enable
-XX:-DisableFlag    # Boolean: disable
-XX:Flag=value      # Key-value
--long-option=value # Standard launcher options (modules, integrity, preview)
-Dkey=value         # System property (read by the JDK libraries, not the VM)
```

Some flags need an unlock flag first: `-XX:+UnlockDiagnosticVMOptions` (diagnostic flags) or `-XX:+UnlockExperimentalVMOptions` (experimental features).

## Memory Sizing

| Flag                               | Description                          | Example                          |
| ---------------------------------- | ------------------------------------ | -------------------------------- |
| `-Xms<size>`                       | Initial heap size                    | `-Xms512m`                       |
| `-Xmx<size>`                       | Maximum heap size                    | `-Xmx4g`                         |
| `-Xss<size>`                       | Platform thread stack size           | `-Xss1m`                         |
| `-XX:MaxMetaspaceSize=<size>`      | Metaspace limit (default: unlimited) | `-XX:MaxMetaspaceSize=256m`      |
| `-XX:MaxDirectMemorySize=<size>`   | Direct (off-heap) buffer limit       | `-XX:MaxDirectMemorySize=512m`   |
| `-XX:ReservedCodeCacheSize=<size>` | JIT compiled code cache              | `-XX:ReservedCodeCacheSize=256m` |

### Quick Formula

```bash
# For a typical server application:
java -Xms2g -Xmx2g -Xss512k -XX:MaxMetaspaceSize=256m -jar myapp.jar
#       ↑       ↑       ↑              ↑
#   Initial = Max    Thread stack    Cap metaspace
#   (avoid resizing)
```

## Object Layout

| Flag                            | Description                                                       | Default                        |
| ------------------------------- | ----------------------------------------------------------------- | ------------------------------ |
| `-XX:+UseCompactObjectHeaders`  | 8-byte object headers (Project Lilliput)                          | <span class="since">On in Java 27</span> |
| `-XX:-UseCompactObjectHeaders`  | Back to the 12-byte header layout                                 | —                              |
| `-XX:+UseCompressedOops`        | 32-bit references for heaps below ~32 GB                          | On (when heap fits)            |

History: compact headers were experimental in JDK 24 (needed `-XX:+UnlockExperimentalVMOptions`), a product option in JDK 25 (opt-in), and the default in JDK 27. See [Chapter 8](../part-3-memory-and-gc/08-object-layout.md).

## Garbage Collector Selection

| Flag                   | Collector                            | When to use                          |
| ---------------------- | ------------------------------------ | ------------------------------------ |
| `-XX:+UseG1GC`         | G1 (**default everywhere** since 27) | General purpose, good default        |
| `-XX:+UseZGC`          | ZGC (generational only)              | Low latency (sub-millisecond pauses) |
| `-XX:+UseShenandoahGC` | Shenandoah                           | Low latency (alternative to ZGC)     |
| `-XX:+UseParallelGC`   | Parallel                             | Throughput-first (batch jobs)        |
| `-XX:+UseSerialGC`     | Serial                               | Tiny heaps, single-CPU containers    |
| `-XX:+UseEpsilonGC`    | Epsilon (no-op, needs unlock)        | Benchmarks and short-lived tests     |

> [!NOTE]
> Before JDK 27, the JVM silently picked **Serial** GC on machines it didn't consider "server class" (fewer than 2 CPUs or less than 1792 MB of memory), which includes many small containers. Since JDK 27 (JEP 523) G1 is the default everywhere. If you relied on Serial in tiny containers, set `-XX:+UseSerialGC` explicitly. The related `-XX:+NeverActAsServerClassMachine` flag is now obsolete.

## GC Tuning

### G1

| Flag                                     | Description                       | Default           |
| ---------------------------------------- | --------------------------------- | ----------------- |
| `-XX:MaxGCPauseMillis=<ms>`              | Target max pause time             | `200`             |
| `-XX:G1HeapRegionSize=<size>`            | Region size (1–32 MB, power of 2) | Auto              |
| `-XX:InitiatingHeapOccupancyPercent=<n>` | Initial threshold for concurrent marking (then adaptive) | `45` |
| `-XX:G1MixedGCCountTarget=<n>`           | Number of mixed GCs after marking | `8`               |

### ZGC

| Flag                         | Description                                | Default |
| ---------------------------- | ------------------------------------------ | ------- |
| `-XX:+UseZGC`                | Enable ZGC (always generational since 24)  | —       |
| `-XX:SoftMaxHeapSize=<size>` | Soft heap limit (ZGC tries to stay below)  | `Xmx`   |

`-XX:+ZGenerational` is **obsolete**: generational mode became the default in JDK 23 (JEP 474) and the only mode in JDK 24 (JEP 490). Passing the flag just prints a warning; remove it.

### Shenandoah

| Flag                                  | Description                               |
| ------------------------------------- | ----------------------------------------- |
| `-XX:ShenandoahGCMode=generational`   | Generational Shenandoah (product since 25; experimental in 24) |

## GC Logging

```bash
# Unified GC logging (Java 9+)
-Xlog:gc*:file=gc.log:time,level,tags:filecount=5,filesize=10m

# Breakdown:
# gc*          → Log all GC-related tags
# file=gc.log  → Write to gc.log
# time,level,tags → Decorators
# filecount=5,filesize=10m → Rotate 5 files of 10 MB each
```

```bash
# Minimal GC logging (just pauses)
-Xlog:gc:file=gc.log

# Verbose (for debugging GC issues)
-Xlog:gc*=debug:file=gc-debug.log:time,level,tags
```

The pre-Java 9 flags `-XX:+PrintGCDetails`, `-XX:+PrintGCTimeStamps` and `-Xloggc:<file>` are replaced by `-Xlog` (`-Xloggc` is deprecated).

## JIT Compiler

| Flag                       | Description                                    | Default |
| -------------------------- | ---------------------------------------------- | ------- |
| `-XX:+TieredCompilation`   | Tiered compilation (C1 + C2)                   | On      |
| `-XX:-TieredCompilation`   | C2 only (skip C1)                              | —       |
| `-XX:TieredStopAtLevel=1`  | C1 only: faster startup, lower peak (dev tools) | —      |
| `-XX:+PrintCompilation`    | Print methods as they're compiled              | Off     |
| `-XX:+PrintInlining`       | Print inlining decisions (diagnostic, needs unlock) | Off |
| `-XX:CompileThreshold=<n>` | Invocations before compiling (non-tiered only) | `10000` |
| `-XX:+UseJVMCICompiler`    | Use Graal JIT instead of C2 (needs a JVMCI-enabled JDK such as GraalVM, plus `-XX:+EnableJVMCI`) | Off |

## AOT Cache (Project Leyden) <span class="since">Java 24</span>

| Flag                                  | Description                                                           |
| ------------------------------------- | --------------------------------------------------------------------- |
| `-XX:AOTCacheOutput=<file>`           | Training run: record and write the AOT cache on exit (JDK 25+)         |
| `-XX:AOTCache=<file>`                 | Use an AOT cache (production run)                                      |
| `-XX:AOTMode=auto\|off\|record\|create\|required` | `auto` (default) uses the cache if it can; `required` (JDK 27; `on` in 24–26) fails fast if it can't |
| `-XX:AOTConfiguration=<file>`         | Configuration file for the explicit record/create workflow (JDK 24)   |
| `-Xlog:aot`                           | Log whether the cache is used and why not                             |

```bash
# JDK 25+: one training run, then production
java -XX:AOTCacheOutput=app.aot -jar myapp.jar   # training: exercise the app, then exit
java -XX:AOTCache=app.aot -jar myapp.jar          # production

# JDK 24: three steps
java -XX:AOTMode=record -XX:AOTConfiguration=app.aotconf -jar myapp.jar
java -XX:AOTMode=create -XX:AOTConfiguration=app.aotconf -XX:AOTCache=app.aot -jar myapp.jar
java -XX:AOTCache=app.aot -jar myapp.jar
```

The cache is only valid for the same JDK build, OS/CPU and a compatible command line (same GC for AOT-compiled code). In JDK 24 and 25 it could not be used with ZGC; since JDK 26 it works with any GC.

### Classic CDS (still supported)

```bash
# Create a dynamic CDS archive (training run)
java -XX:ArchiveClassesAtExit=app-cds.jsa -jar myapp.jar

# Use it
java -XX:SharedArchiveFile=app-cds.jsa -jar myapp.jar
```

## Diagnostics

| Flag                               | Description                       |
| ---------------------------------- | --------------------------------- |
| `-XX:+HeapDumpOnOutOfMemoryError`  | Dump heap on OOM (always enable!) |
| `-XX:HeapDumpPath=<path>`          | Where to write heap dumps         |
| `-XX:OnOutOfMemoryError="<cmd>"`   | Run a command on OOM              |
| `-XX:+ExitOnOutOfMemoryError`      | Kill JVM on OOM (for containers)  |
| `-XX:NativeMemoryTracking=summary` | Track native memory usage         |
| `-XX:+UnlockDiagnosticVMOptions`   | Unlock diagnostic flags           |

```bash
# Production essentials
java -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/var/dumps/ \
     -XX:+ExitOnOutOfMemoryError \
     -jar myapp.jar
```

## Flight Recorder

```bash
# Start recording at launch
-XX:StartFlightRecording=duration=60s,filename=recording.jfr

# Continuous recording (ring buffer)
-XX:StartFlightRecording=disk=true,maxage=6h,maxsize=1g,dumponexit=true,filename=app.jfr
```

Newer JFR options:

| Option                                                                         | What it does                                         | Since |
| ------------------------------------------------------------------------------ | ---------------------------------------------------- | ----- |
| `-XX:StartFlightRecording=jdk.CPUTimeSample#enabled=true,filename=cpu.jfr`     | CPU-time profiling (experimental, Linux only)        | 25    |
| `-XX:StartFlightRecording:method-timing=::<clinit>,filename=t.jfr`             | Count and time calls to selected methods             | 25    |
| `-XX:StartFlightRecording:method-trace=java.util.HashMap::resize,filename=t.jfr` | Record a stack trace for each call                 | 25    |
| `-XX:FlightRecorderOptions:redact-key=+mysecret`                               | Extra patterns for redacting env/system properties   | 27    |

View results with `jfr view cpu-time-hot-methods cpu.jfr` or `jfr view method-timing t.jfr`. Since JDK 27, JFR redacts values that look like secrets (`*password*`, `*token*`…) in command-line arguments, environment variables and system properties by default.

## Module System and Integrity

```bash
# Open a package for deep reflection
--add-opens java.base/java.lang=ALL-UNNAMED

# Export a non-exported package
--add-exports java.base/sun.nio.ch=ALL-UNNAMED

# Add a module to the root set
--add-modules jdk.incubator.vector
```

| Flag                                                   | Purpose                                                            | Since |
| ------------------------------------------------------ | ------------------------------------------------------------------ | ----- |
| `--enable-native-access=ALL-UNNAMED\|M1,M2`            | Allow restricted FFM methods and JNI library loading without warnings | 22 (JNI covered since 24) |
| `--illegal-native-access=allow\|warn\|deny`            | What happens otherwise (default `warn`)                            | 24    |
| `--sun-misc-unsafe-memory-access=allow\|warn\|debug\|deny` | `sun.misc.Unsafe` memory-access methods (default `warn`)       | 23    |
| `--enable-final-field-mutation=ALL-UNNAMED\|M1,M2`     | Allow reflective mutation of `final` fields                        | 26    |
| `--illegal-final-field-mutation=allow\|warn\|debug\|deny` | What happens otherwise (default `warn`, future `deny`)          | 26    |
| `--enable-preview`                                     | Enable preview language/VM features (also needed at compile time)  | 12    |

Executable JARs can use manifest attributes instead: `Add-Opens`, `Add-Exports`, `Enable-Native-Access: ALL-UNNAMED`, `Enable-Final-Field-Mutation: ALL-UNNAMED`. See [Chapter 23](../part-7-ecosystem/23-module-system.md#integrity-by-default).

## Virtual Threads

| Flag                                              | Description                                                 |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `-Djdk.virtualThreadScheduler.parallelism=<n>`    | Number of carrier threads (default: number of CPUs)         |
| `-Djdk.virtualThreadScheduler.maxPoolSize=<n>`    | Max carriers when some are blocked (default 256)            |

`-Djdk.tracePinnedThreads` has no effect since JDK 24, which removed `synchronized` pinning (JEP 491); use the JFR event `jdk.VirtualThreadPinned` to find remaining pinning (for example, native frames).

## Container-Aware Flags

```bash
# Since Java 10, the JVM is container-aware by default
# It reads cgroup (v1 and v2) limits for CPU and memory

# Override if needed:
-XX:ActiveProcessorCount=4          # Override detected CPU count
-XX:MaxRAMPercentage=75.0           # Use 75% of container memory for heap
-XX:InitialRAMPercentage=50.0       # Start at 50%
```

## Obsolete and Removed Flags

Old tuning guides are full of these. **Obsolete** flags are accepted with a warning and ignored; **removed** ones make the JVM refuse to start (`Unrecognized VM option`).

| Flag                                                   | Status                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| `-XX:+ZGenerational` / `-XX:-ZGenerational`            | Obsolete since 24: ZGC is always generational                       |
| `-XX:+UseBiasedLocking` and `BiasedLocking*` flags     | Biased locking deprecated in 15, removed in 18: don't use           |
| `-XX:+UseConcMarkSweepGC` and `CMS*` flags             | CMS removed in JDK 14: use G1, ZGC or Shenandoah                    |
| `-XX:+UseParNewGC`                                     | Gone with CMS                                                       |
| `-XX:PermSize`, `-XX:MaxPermSize`                      | PermGen removed in JDK 8: use `-XX:MaxMetaspaceSize`                |
| `--illegal-access=permit`                              | Obsolete since 17: use targeted `--add-opens`                       |
| `-XX:+UseRTMLocking` and `RTM*` flags                  | Obsolete since 24                                                   |
| `-XX:+NeverActAsServerClassMachine`                    | Obsolete in 27: G1 is the default everywhere                        |
| `-Djava.security.manager=allow`                        | Security Manager permanently disabled in 24 (JEP 486): startup error |
| `-Djdk.tracePinnedThreads`                             | Removed in 24 (setting it has no effect)                            |

## sbt / Scala-Specific

```scala
// In build.sbt (javaOptions apply to forked JVMs only)
fork := true
javaOptions ++= Seq(
  "-Xmx4g",
  "-XX:+UseZGC",
  "--add-opens", "java.base/java.lang=ALL-UNNAMED",
  "--enable-native-access=ALL-UNNAMED",
  "-XX:+HeapDumpOnOutOfMemoryError"
)
```

```bash
# For sbt itself (in .sbtopts, prefix each JVM option with -J, or use .jvmopts / SBT_OPTS)
-Xmx2g
-Xss2m
```

## Common Combinations

### Development

```bash
java -Xms256m -Xmx1g \
     -XX:+HeapDumpOnOutOfMemoryError \
     -jar myapp.jar
```

### Production (General)

```bash
java -Xms4g -Xmx4g \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=100 \
     -XX:AOTCache=app.aot \
     -Xlog:gc*:file=gc.log:time,level,tags:filecount=5,filesize=10m \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/var/dumps/ \
     -XX:+ExitOnOutOfMemoryError \
     -XX:StartFlightRecording=disk=true,maxage=6h,maxsize=1g,dumponexit=true \
     -jar myapp.jar
```

### Production (Low Latency)

```bash
java -Xms8g -Xmx8g \
     -XX:+UseZGC \
     -Xlog:gc*:file=gc.log:time,level,tags:filecount=5,filesize=10m \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/var/dumps/ \
     -XX:+ExitOnOutOfMemoryError \
     -jar myapp.jar
```

### Container / Kubernetes

```bash
java -XX:MaxRAMPercentage=75.0 \
     -XX:+ExitOnOutOfMemoryError \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:AOTCache=/app/app.aot \
     -Xlog:gc*:stdout:time,level,tags \
     -jar myapp.jar
```

On JDK 27, G1 is chosen even in a 1-CPU container, so `-XX:+UseG1GC` is no longer needed to avoid an accidental Serial GC.
