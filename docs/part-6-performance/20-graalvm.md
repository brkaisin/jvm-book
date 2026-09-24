# Chapter 20 — Ahead-of-Time: Project Leyden and GraalVM Native Image

## The Startup and Warmup Problem

The JIT we just studied is wonderful for long-running servers: it watches the program, bets on what it sees, and ends up with machine code tuned to the real workload. But all of that happens *at runtime*, and it has a price at the start of every run:

1. **Startup**: before `main` does anything useful, the JVM loads, verifies, and links hundreds or thousands of classes, runs static initializers, and (for frameworks like Spring) scans the classpath, reads annotations, and builds proxies.
2. **Warmup**: once the app is up, it runs in the interpreter and C1 code until the JIT has gathered profiles and C2 has compiled the hot paths. For a big service that can take many seconds or minutes, during which latency is worse and CPU use is higher.

For a server that runs for weeks, nobody cares. For a CLI tool, a serverless function, a test suite, or a container that autoscales under load, it matters a lot. And the frustrating part is that **the JVM does exactly the same work, with nearly the same result, every single time the app starts**.

The answer is to do some of that work *ahead of time*. There are two very different ways of doing that on the JVM today, and this chapter covers both.

## A Spectrum, Not a Switch

"Ahead-of-time" isn't one thing. Think of it as a spectrum: the more you decide before the program runs, the faster it starts, and the less dynamic it is allowed to be. Figure 20.1 shows the stations along the way.

<figure class="fig">
{{#include ../figures/20-aot-spectrum.svg}}
<figcaption><b>Figure 20.1</b> — Each station precomputes more than the one before it; everything up to the AOT cache is still a full JVM, and only Native Image trades dynamism for a closed world.</figcaption>
</figure>

Moving right, startup and warmup get faster. Everything up to and including the Leyden AOT cache keeps the **full dynamism of Java**: class loading, reflection, bytecode generation, and a JIT that can re-optimize. The last step, Native Image, gives some of that up in exchange for the fastest startup and the smallest footprint.

## Project Leyden: The AOT Cache

[Project Leyden](https://openjdk.org/projects/leyden/) is the OpenJDK project for improving startup, warmup, and footprint. Its approach is simple to state: run the application once as a **training run**, record what the JVM did, save it in an **AOT cache**, and reuse that cache in production.

### Where It Comes From: Class Data Sharing

Leyden builds on a feature that has been around for years: **Class Data Sharing (CDS)**. CDS stores parsed class metadata in an archive file that the JVM memory-maps at startup instead of parsing `.class` files again. Since JDK 12 the JDK ships with a default CDS archive for its own classes (that's the `sharing` in `java -version`), and AppCDS extends it to your application classes.

The AOT cache generalizes CDS: same idea, more things stored, and a simpler workflow.

### What Goes in the Cache, Release by Release

<p class="timeline-title">What the AOT cache stores</p>
<ol class="timeline">
<li><span class="when">JDK 24</span>Loaded and linked classes (JEP 483)</li>
<li><span class="when">JDK 25</span>One-step training (JEP 514)<br/>Method profiles (JEP 515)</li>
<li><span class="when">JDK 26</span>Cached objects work with any GC, incl. ZGC (JEP 516)</li>
<li class="future"><span class="when">JDK 28 (proposed)</span>Compiled native code (JEP 544)</li>
</ol>

- **Classes** <span class="since">Java 24</span> ([JEP 483](https://openjdk.org/jeps/483)): classes are stored already loaded and linked, so the JVM skips reading, parsing, verifying, and linking them. The JEP measures a 42% startup improvement for Spring PetClinic (4.486 s on JDK 23 → 2.604 s on JDK 24 with an AOT cache), and, by coincidence, 42% on a tiny Stream program too.
- **Simpler workflow** <span class="since">Java 25</span> ([JEP 514](https://openjdk.org/jeps/514)): one training command instead of two.
- **Method profiles** <span class="since">Java 25</span> ([JEP 515](https://openjdk.org/jeps/515)): the JIT's profiles from training are stored too, so C2 can compile hot methods right away in production (see [Chapter 19](19-jit-deep-dive.md#aot-profiles-and-aot-code-warming-up-the-jit-in-advance)). The JEP's example program gets 19% faster.
- **Any GC** <span class="since">Java 26</span> ([JEP 516](https://openjdk.org/jeps/516)): objects in the cache are stored in a GC-neutral format, so the cache now works with ZGC as well as the other collectors.
- **Native code** (proposed for Java 28, [JEP 544](https://openjdk.org/jeps/544)): code compiled by C1 and C2 during training is stored in the cache and loaded instantly. The JEP reports that the AOT cache alone cuts startup by 50–70% on framework benchmarks, and 65–80% with AOT code; for warmup, `javac` reaches about 75% better first-iteration performance with cache plus code.

### Using It

On JDK 25 and later, it's two commands:

```bash
# 1. Training run: a representative workload; the cache is written on exit
java -XX:AOTCacheOutput=app.aot -cp app.jar com.example.App

# 2. Production: start with the cache
java -XX:AOTCache=app.aot -cp app.jar com.example.App
```

On JDK 24 the same thing took three steps (record a configuration, create the cache, run):

```bash
java -XX:AOTMode=record -XX:AOTConfiguration=app.aotconf \
     -cp app.jar com.example.App
java -XX:AOTMode=create -XX:AOTConfiguration=app.aotconf \
     -XX:AOTCache=app.aot -cp app.jar
java -XX:AOTCache=app.aot -cp app.jar com.example.App
```

There's no new tool, no new language rules, and no code changes. If the cache can't be used (wrong JDK, different classpath…), the JVM simply ignores it and starts normally.

> [!TIP]
> In CI or in a container build, you usually want to *know* the cache is used rather than silently lose the speed-up. Add `-XX:AOTMode=required` (JDK 27; on JDK 24–26 the same mode is spelled `-XX:AOTMode=on`) to make the JVM exit with an error if the cache is unusable.

A natural place for the training run is your container build: run the app against a smoke-test workload in one build stage, and ship the resulting `app.aot` next to the JAR.

### Training Run Caveats

The cache is only as good as the training run, and it's only valid for a matching environment:

> [!WARNING]
> - **Same JDK release, same OS, same CPU architecture** for training and production.
> - **Same classpath**: production may append extra entries at the end, but otherwise it must be identical, and it must contain **only JAR files** (no directories). Module options (`-p`, `--add-modules`, …) must match too.
> - Only classes loaded by the **JDK's built-in class loaders** are cached; classes from custom class loaders are loaded the normal way.
> - For AOT **code** (JEP 544), training and production must also use the same GC and CPU features.
> - A training run that doesn't exercise the real code paths (for example, one that starts the app and exits) caches classes but produces poor profiles. Make it look like production traffic.

Nothing breaks if production diverges from training; the JVM just loads, profiles, and compiles the missing parts the usual way. You lose some of the benefit, not correctness.

## GraalVM Native Image: The Closed World

**Native Image** takes the opposite approach. Instead of making the JVM start faster, it removes the JVM: it compiles your application, its libraries, and the parts of the JDK it uses into a **standalone native executable**. At runtime there is no bytecode, no class loading, and no JIT. There's a small runtime (called Substrate VM) that provides the GC, threads, and exception handling.

### How It Works

```text
    ┌────────────────────────────────────────┐
    │ Your classes + dependencies + JDK      │
    └────────────────────────────────────────┘
                        │
┌─ native-image build ──┼─────────────────────────┐
│                       ▼     takes minutes       │
│   ┌────────────────────────────────────────┐    │
│   │ 1. Points-to analysis                  │    │
│   │    find all reachable code             │    │
│   └────────────────────────────────────────┘    │
│                       │                         │
│                       ▼                         │
│   ┌────────────────────────────────────────┐    │
│   │ 2. Build-time initialization           │    │
│   │    run safe static initializers        │    │
│   └────────────────────────────────────────┘    │
│                       │                         │
│                       ▼                         │
│   ┌────────────────────────────────────────┐    │
│   │ 3. Image heap snapshot                 │    │
│   │    initialized objects saved into      │    │
│   │    the binary                          │    │
│   └────────────────────────────────────────┘    │
│                       │                         │
│                       ▼                         │
│   ┌────────────────────────────────────────┐    │
│   │ 4. AOT compilation                     │    │
│   │    reachable methods to machine code   │    │
│   └───────────────────┬────────────────────┘    │
└───────────────────────┼─────────────────────────┘
                        ▼
    ┌────────────────────────────────────────┐
    │ ./myapp                                │
    │ native executable, no JVM needed       │
    └────────────────────────────────────────┘
```

The key word is **reachable**. The analysis starts from `main` and follows every call, field access, and allocation it can see. Anything it can't reach is not in the binary. That's what makes the result small and fast, and it's also the source of every Native Image headache.

```bash
# From a JAR
native-image -jar myapp.jar -o myapp

# From a main class
native-image -cp myapp.jar com.example.Main -o myapp

# Run it
./myapp   # starts in milliseconds
```

With Maven or Gradle, the GraalVM **Native Build Tools** plugins run the build for you.

### The Closed-World Assumption

Native Image must see **all code that can ever run, at build time**. Whatever the analysis can't see statically needs to be declared:

- **Reflection**: `Class.forName(name)`, `method.invoke()` with names computed at runtime
- **Resources** loaded with `getResource`
- **JNI**, **dynamic proxies**, and **serialization**
- **Dynamic class loading and runtime bytecode generation** (ByteBuddy, CGLIB, runtime-generated proxies) are not supported at all; frameworks that need them generate the code at build time instead

These declarations are called **reachability metadata**. Current GraalVM versions read a single `reachability-metadata.json` file, placed on the classpath under `META-INF/native-image/<groupId>/<artifactId>/`:

```json
{
  "reflection": [
    {
      "type": "com.example.MyClass",
      "allDeclaredConstructors": true,
      "methods": [
        { "name": "process", "parameterTypes": ["java.lang.String"] }
      ]
    }
  ]
}
```

You rarely write this by hand:

- Many libraries ship their own metadata, and the **GraalVM Reachability Metadata Repository** provides it for popular libraries that don't (the Native Build Tools plugins pull it in automatically).
- The **tracing agent** records what your app does on a regular JVM and writes the metadata for you:

```bash
java -agentlib:native-image-agent=config-output-dir=src/main/resources/META-INF/native-image/com.example/myapp \
     -jar myapp.jar
# ... exercise the application, then stop it ...
```

The agent only sees code paths you actually exercise, so run your tests (or a realistic scenario) with it.

### Build-Time Initialization

Native Image can run class initializers (static blocks, Scala `object` bodies) at **build time** and save the resulting objects into the binary's *image heap*. At runtime they are simply there, already initialized.

By default, Native Image initializes most JDK classes at build time, and application classes at build time only if it can prove it's safe; everything else is initialized at run time, like on the JVM. You can opt a class in explicitly:

```bash
native-image --initialize-at-build-time=com.example.Config -jar myapp.jar
```

> [!CAUTION]
> Build-time initialization freezes whatever the initializer computed. If it reads environment variables, the current time, a random seed, or opens a connection, those values (or broken handles) end up baked into the binary and shared by every run.

### Profile-Guided Optimization

Without a JIT, Native Image compiles without knowing which branches are hot. **PGO** (available in Oracle GraalVM) closes part of that gap by compiling twice:

```bash
# 1. Build an instrumented binary
native-image --pgo-instrument -jar myapp.jar -o myapp-inst

# 2. Run it under realistic load; it writes default.iprof on exit
./myapp-inst

# 3. Rebuild using the profile
native-image --pgo=default.iprof -jar myapp.jar -o myapp
```

### When to Use Native Image

**Good fit:**
- CLI tools, where every millisecond of startup is visible
- Serverless functions and services that scale to zero
- Memory-constrained deployments with many small instances
- Distributing a single binary without asking users to install Java

**Poor fit:**
- Long-running services where peak throughput matters most (the JIT, with real profiles, usually wins)
- Code that relies on runtime bytecode generation or heavy, dynamic reflection
- Teams that can't afford minutes-long builds or testing a separate "native" variant of the app

On the framework side, **Quarkus**, **Micronaut**, **Helidon**, and **Spring Boot** (through Spring AOT) all support Native Image; they move reflection and proxy generation to build time so that the closed world is easy to satisfy.

## The Graal JIT Compiler and Truffle

GraalVM is more than Native Image. Its core is **Graal**, an optimizing compiler written in Java. It's the compiler Native Image uses to produce machine code, and in GraalVM distributions it also replaces C2 as the JIT (plugged into HotSpot through the JVMCI interface).

Its best-known advantage is **partial escape analysis**. C2's escape analysis ([Chapter 19](19-jit-deep-dive.md#escape-analysis)) is all-or-nothing: if an object escapes on *any* path, it's allocated. Graal allocates it only on the paths where it actually escapes:

```java
Point p = new Point(x, y);
if (rare) {
    cache.put(key, p);     // escapes here: Graal allocates p only on this path
}
return p.x() + p.y();      // on the common path, p stays in registers
```

This is particularly helpful for Scala code, which creates many short-lived objects (tuples, closures, `Option`s) that escape only on uncommon paths.

**Truffle** is a framework for writing language interpreters that Graal turns into optimized machine code (through *partial evaluation* of the interpreter together with the user's program). The GraalVM languages are built with it: **GraalJS** (JavaScript), **GraalPy** (Python), **TruffleRuby**, and **GraalWasm** (WebAssembly). You embed them from Java with the polyglot API, and they can pass objects to each other:

```java
import org.graalvm.polyglot.Context;

try (var context = Context.create("js", "python")) {
    context.eval("js", "console.log('Hello from JS!')");
    context.eval("python", "print('Hello from Python!')");
}
```

These languages are ordinary Maven dependencies and also run on a regular JDK; on GraalVM they get Graal's JIT for full speed.

## GraalVM in 2025 and After

In September 2025, alongside GraalVM 25, Oracle announced it was **"detaching GraalVM from the Java ecosystem train"**:

- **Oracle GraalVM for JDK 24 was the last release** licensed and supported as part of Oracle's Java SE products.
- The GraalVM team **refocused on the non-Java Graal languages**, such as GraalPy and GraalJS.
- The goals Native Image was serving for Java (startup, warmup, footprint) are being pursued **inside OpenJDK through Project Leyden**, as a standard part of the platform.

This is not the end of Native Image as a technology. GraalVM 25 shipped (followed by updates such as 25.0.2 in January 2026, on the quarterly critical-patch cadence), and the frameworks above continue to support it. What changed is the direction: for most Java and Scala teams that want faster startup, **Leyden is now the mainstream, zero-code-change path**, and Native Image is the specialized tool for when you need the smallest, fastest-starting, closed-world binary.

## Leyden vs Native Image vs Plain JIT

| Aspect                   | Plain JIT              | Leyden AOT cache              | Native Image                 |
| ------------------------ | ---------------------- | ----------------------------- | ---------------------------- |
| Startup                  | Slowest                | Much faster                   | Fastest (milliseconds)       |
| Warmup                   | Slow (profiles first)  | Faster (cached profiles, code soon) | None, but code is fixed at build |
| Peak performance         | Excellent              | Excellent (same JIT)          | Good; PGO helps              |
| Memory footprint         | Highest                | Similar to plain JVM          | Lowest                       |
| Java dynamism            | Full                   | Full                          | Closed world, needs metadata |
| Build step               | None                   | One training run              | Minutes-long native build    |
| Output                   | JAR + JDK              | JAR + JDK + `app.aot`         | Single native executable     |
| Part of OpenJDK          | Yes                    | Yes (JDK 24+)                 | No (GraalVM)                 |

A reasonable default in 2026: start with the plain JVM, add an AOT cache when startup or warmup matters (it's nearly free), and reach for Native Image when you need what only a closed world gives you.

## The Scala Angle

> **Meanwhile, in Scala land**
>
> - **Leyden just works.** The AOT cache knows nothing about the source language: a Scala app packaged as a JAR (for example with `sbt assembly`) can be trained and started with `-XX:AOTCacheOutput` / `-XX:AOTCache` exactly like a Java app. Remember the "JARs only" rule: running from `target/scala-3.x/classes` directories won't be cached.
> - **Native Image works with Scala** too. Most Scala code is quite friendly to a closed world: type classes and derivation (circe, zio-json…) are resolved at compile time. Trouble comes from Java libraries using reflection, from structural types (`reflectiveSelectable`), and from runtime class loading. The tracing agent covers most of it. For sbt, `sbt-native-packager` has a `GraalVMNativeImagePlugin`:
>
>   ```scala
>   // build.sbt
>   enablePlugins(GraalVMNativeImagePlugin)
>   graalVMNativeImageOptions ++= Seq("--no-fallback")
>   ```
>
> - **Scala CLI** can build a native image in one command:
>
>   ```bash
>   scala-cli --power package MyApp.scala -o myapp --native-image
>   ```
>
> - **Scala Native is a different project.** It compiles Scala to native code through LLVM, with its own runtime and GC, and doesn't use the JVM or GraalVM at all (`scala-cli --power package --native …`). It's great for small tools, but you use Scala Native versions of libraries instead of arbitrary JVM JARs.

Framework support for Native Image varies. As a rough guide:

| Scala stack        | Native Image                                      |
| ------------------ | ------------------------------------------------- |
| http4s (Ember)     | Works well                                        |
| ZIO / ZIO HTTP     | Works well                                        |
| Scala CLI          | Is itself distributed as a native image           |
| Pekko / Akka       | Partial (reflection-based serialization needs config) |
| Play Framework     | Limited                                           |
| Spark              | Not realistic (dynamic class loading and codegen) |

<div class="takeaways">

## Key Takeaways

- The JVM repeats the same startup and warmup work on every run; **ahead-of-time** techniques do it once
- **Project Leyden** stores that work in an **AOT cache** from a **training run**: classes (24), profiles (25), any GC (26), and compiled code (proposed for 28)
- Two commands on JDK 25+: `-XX:AOTCacheOutput=app.aot` to train, `-XX:AOTCache=app.aot` to run; same JDK, OS, architecture, and classpath (JARs only) required
- Leyden keeps **full Java dynamism** and the JIT, so peak performance is unchanged
- **GraalVM Native Image** compiles a **closed world** into a standalone executable: fastest startup, smallest footprint, but reflection and resources need **reachability metadata** and the build takes minutes
- **Graal** is also a JIT (with partial escape analysis) and powers **Truffle** languages like GraalPy and GraalJS
- Since 2025, Oracle has moved GraalVM's focus to non-Java languages; **Leyden is the mainstream path** for faster Java startup, Native Image remains the specialist tool
- Scala apps benefit from both; **Scala Native** is a separate, LLVM-based project

</div>
