# Appendix A — JVM Flags Cheat Sheet

[← Appendices](index.md) · [Next: Bytecode Reference →](b-bytecode-reference.md)

---

This is a curated list of JVM flags you'll actually use, grouped by purpose. Not exhaustive — there are 800+ flags — but these are the ones that matter.

## Flag Syntax

```bash
-Xflag          # Non-standard (but universal) flags
-XX:+EnableFlag  # Boolean: enable
-XX:-DisableFlag # Boolean: disable
-XX:Flag=value   # Key-value
```

## Memory Sizing

| Flag                               | Description                          | Example                          |
| ---------------------------------- | ------------------------------------ | -------------------------------- |
| `-Xms<size>`                       | Initial heap size                    | `-Xms512m`                       |
| `-Xmx<size>`                       | Maximum heap size                    | `-Xmx4g`                         |
| `-Xss<size>`                       | Thread stack size                    | `-Xss1m`                         |
| `-XX:MaxMetaspaceSize=<size>`      | Metaspace limit (default: unlimited) | `-XX:MaxMetaspaceSize=256m`      |
| `-XX:MaxDirectMemorySize=<size>`   | Direct (off-heap) memory limit       | `-XX:MaxDirectMemorySize=512m`   |
| `-XX:ReservedCodeCacheSize=<size>` | JIT compiled code cache              | `-XX:ReservedCodeCacheSize=256m` |

### Quick Formula

```bash
# For a typical server application:
java -Xms2g -Xmx2g -Xss512k -XX:MaxMetaspaceSize=256m -jar myapp.jar
#       ↑       ↑       ↑              ↑
#   Initial = Max    Thread stack    Cap metaspace
#   (avoid resizing)
```

## Garbage Collector Selection

| Flag                   | Collector                 | When to use                       |
| ---------------------- | ------------------------- | --------------------------------- |
| `-XX:+UseG1GC`         | G1 (default since Java 9) | General purpose, good default     |
| `-XX:+UseZGC`          | ZGC                       | Low-latency (< 1 ms pauses)       |
| `-XX:+UseShenandoahGC` | Shenandoah                | Low-latency (alternative to ZGC)  |
| `-XX:+UseParallelGC`   | Parallel                  | Throughput-first (batch jobs)     |
| `-XX:+UseSerialGC`     | Serial                    | Tiny heaps, containers with 1 CPU |

## GC Tuning

### G1

| Flag                                     | Description                       | Default |
| ---------------------------------------- | --------------------------------- | ------- |
| `-XX:MaxGCPauseMillis=<ms>`              | Target max pause time             | `200`   |
| `-XX:G1HeapRegionSize=<size>`            | Region size (1-32 MB, power of 2) | Auto    |
| `-XX:InitiatingHeapOccupancyPercent=<n>` | When to start concurrent marking  | `45`    |
| `-XX:G1MixedGCCountTarget=<n>`           | Number of mixed GCs after marking | `8`     |

### ZGC

| Flag                         | Description                                | Default                   |
| ---------------------------- | ------------------------------------------ | ------------------------- |
| `-XX:+UseZGC`                | Enable ZGC                                 | —                         |
| `-XX:+ZGenerational`         | Enable generational ZGC (Java 21+)         | On by default in Java 23+ |
| `-XX:SoftMaxHeapSize=<size>` | Soft heap limit (ZGC returns memory to OS) | `Xmx`                     |

## GC Logging

```bash
# Modern GC logging (Java 9+)
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

## JIT Compiler

| Flag                       | Description                                  | Default |
| -------------------------- | -------------------------------------------- | ------- |
| `-XX:+TieredCompilation`   | Enable tiered compilation (C1 + C2)          | On      |
| `-XX:-TieredCompilation`   | C2 only (skip C1)                            | —       |
| `-XX:+PrintCompilation`    | Print methods as they're compiled            | Off     |
| `-XX:+PrintInlining`       | Print inlining decisions                     | Off     |
| `-XX:CompileThreshold=<n>` | Invocations before JIT compiles (non-tiered) | `10000` |
| `-XX:+UseJVMCICompiler`    | Use Graal JIT instead of C2                  | Off     |

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

## Module System

```bash
# Open a package for reflection
--add-opens java.base/java.lang=ALL-UNNAMED

# Export a package
--add-exports java.base/sun.nio.ch=ALL-UNNAMED

# Add a module
--add-modules java.sql
```

## Container-Aware Flags

```bash
# Since Java 10, the JVM is container-aware by default
# It reads cgroup limits for CPU and memory

# Override if needed:
-XX:ActiveProcessorCount=4          # Override detected CPU count
-XX:MaxRAMPercentage=75.0           # Use 75% of container memory for heap
-XX:InitialRAMPercentage=50.0       # Start at 50%
```

## CDS (Class Data Sharing) / Leyden

```bash
# Create CDS archive (training run)
java -XX:ArchiveClassesAtExit=app-cds.jsa -jar myapp.jar

# Use CDS archive (fast startup)
java -XX:SharedArchiveFile=app-cds.jsa -jar myapp.jar
```

## sbt / Scala-Specific

```bash
# In build.sbt
javaOptions ++= Seq(
  "-Xmx4g",
  "-XX:+UseZGC",
  "--add-opens", "java.base/java.lang=ALL-UNNAMED",
  "-XX:+HeapDumpOnOutOfMemoryError"
)

# For sbt itself (in .sbtopts or SBT_OPTS)
-Xmx2g
-Xss2m
--add-opens=java.base/java.lang=ALL-UNNAMED
```

## Common Combinations

### Development

```bash
java -Xms256m -Xmx1g \
     -XX:+UseG1GC \
     -XX:+HeapDumpOnOutOfMemoryError \
     -jar myapp.jar
```

### Production (General)

```bash
java -Xms4g -Xmx4g \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=100 \
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
     -XX:+ZGenerational \
     -Xlog:gc*:file=gc.log:time,level,tags:filecount=5,filesize=10m \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/var/dumps/ \
     -XX:+ExitOnOutOfMemoryError \
     -jar myapp.jar
```

### Container / Kubernetes

```bash
java -XX:MaxRAMPercentage=75.0 \
     -XX:+UseG1GC \
     -XX:+ExitOnOutOfMemoryError \
     -XX:+HeapDumpOnOutOfMemoryError \
     -Xlog:gc*:stdout:time,level,tags \
     -jar myapp.jar
```

---

[← Appendices](index.md) · [Next: Bytecode Reference →](b-bytecode-reference.md)
