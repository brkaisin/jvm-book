# Chapter 3 — A Timeline of the JVM

## 30 Years of Evolution

The JVM has changed dramatically since its birth in 1995. What started as a slow interpreter for web applets is now one of the most sophisticated runtime platforms in existence. Let's walk through the major milestones — and see how Scala and the JVM evolved together.

Here's the whole story at a glance, before we zoom in:

<p class="timeline-title">30 years of the JVM at a glance</p>
<ol class="timeline">
<li><span class="when">1996</span><strong>Java 1.0</strong> — a pure bytecode interpreter</li>
<li><span class="when">2000</span><strong>Java 1.3</strong> — HotSpot and its adaptive JIT become the default</li>
<li><span class="when">2004</span><strong>Java 5</strong> — generics, annotations, <code>java.util.concurrent</code>; Scala 1.0 ships the same year</li>
<li><span class="when">2011</span><strong>Java 7</strong> — <code>invokedynamic</code> opens the JVM to other languages</li>
<li><span class="when">2014</span><strong>Java 8 LTS</strong> — lambdas and streams</li>
<li><span class="when">2017</span><strong>Java 9</strong> — modules, and the six-month release train starts</li>
<li><span class="when">2021</span><strong>Java 17 LTS</strong> — records, sealed classes; Scala 3.0 ships</li>
<li><span class="when">2023</span><strong>Java 21 LTS</strong> — virtual threads</li>
<li><span class="when">2025</span><strong>Java 25 LTS</strong> — the AOT cache, compact object headers, scoped values</li>
<li><span class="when">2026</span><strong>Java 27</strong> — compact headers and G1 on by default everywhere; Scala 3.9 LTS</li>
<li class="future"><span class="when">2027</span><strong>Java 28</strong> — value objects arrive as a preview (Project Valhalla)</li>
</ol>

## The Early Years (1995–2002)

### Java 1.0 (1996) — The Birth

The first public release. The JVM was a **pure interpreter** — it read bytecode instruction by instruction and executed each one. No JIT compilation. Performance was… not great.

Key features:
- Bytecode interpreter
- Green threads (user-space threads scheduled by the JVM, not real OS threads)
- Garbage collection (a simple mark-sweep collector)
- A security sandbox with the `SecurityManager`
- AWT for GUI

> **Historical context**: Java launched with the promise of running in web browsers (Java applets). The JVM was embedded in Netscape Navigator. It was slow, but it *worked* across platforms.

### Java 1.1 (1997) — Growing Up

- Inner classes
- JDBC (database connectivity)
- Reflection API — inspect classes, methods, and fields at runtime
- RMI (Remote Method Invocation)

### Java 1.2 (1998) — "Java 2"

A major release that transformed the platform:

- **JIT compilation** — The JDK now shipped with a JIT compiler that turns hot bytecode into native machine code at runtime. Massive performance improvement.
- **Native OS threads** — Over these releases, green threads gave way to real operating system threads: each Java `Thread` maps to one OS thread. That one-to-one mapping remained the rule until virtual threads arrived in Java 21, over 20 years later!
- Collections framework (`ArrayList`, `HashMap`, etc.)
- Swing GUI toolkit
- The "Java 2 Platform" branding (J2SE, J2EE, J2ME)

### Java 1.3 (2000)

- **HotSpot JVM** becomes the default — this is the JVM we still use today (in evolved form). It first shipped in 1999 as an add-on for 1.2.
- HotSpot introduced *adaptive optimization*: it profiles your running code and optimizes the hot paths
- JNDI (naming and directory)

### Java 1.4 (2002)

- `assert` keyword
- NIO (non-blocking I/O) — `java.nio` package
- Regular expressions (`java.util.regex`)
- XML parsing
- Logging API

> **Meanwhile, in Scala land**: Martin Odersky, who had previously worked on Generic Java (which became Java generics) and the Pizza language, started designing Scala in 2001 at EPFL. The first public Scala release came in 2004.

## The Maturation (2004–2014)

### Java 5 (2004) — A Language Revolution

The biggest language change in Java's history at that point:

- **Generics** — `List<String>` instead of `List` with casting. But implemented via *type erasure* — the JVM doesn't know about generics at runtime (more in [Chapter 12](../part-4-type-system/12-types-at-runtime.md))
- **Annotations** — `@Override`, `@Deprecated`, and the ability to create custom annotations
- **Autoboxing/unboxing** — Automatic conversion between `int` ↔ `Integer`
- **Enhanced for-loop** — `for (String s : list)`
- **Enums** — Type-safe enumerations
- **Varargs** — `void method(String... args)`
- `java.util.concurrent` — `ExecutorService`, `ConcurrentHashMap`, `Lock`, `Atomic*` classes

> **Scala 1.0 (2004)** was released the same year as Java 5! Scala already had:
> - Type inference (Java wouldn't get even local `var` inference until Java 10, in 2018)
> - Pattern matching (Java's first step: Java 14, in 2020)
> - Case classes (Java's records: Java 16, in 2021)
> - Traits with implementations (Java's default methods: Java 8, in 2014)
> - First-class functions (Java's lambdas: Java 8, in 2014)

### Java 6 (2006)

Mostly a performance and tooling release:
- Significant JIT compiler improvements
- Scripting API (JSR 223) — run JavaScript and other scripting languages on the JVM
- JDBC 4.0
- Pluggable annotation processors

> **Scala 2.0 (2006)**: Major redesign of the language.

### Java 7 (2011) — The Long Wait

Five years between releases (Sun's financial troubles, Oracle acquisition in 2010):

- **`invokedynamic` bytecode instruction** — This is *huge*. A new bytecode instruction that lets the JVM defer method linking to runtime. Originally designed for dynamic languages (JRuby, Jython), it later became the foundation for Java 8 lambdas and many Scala features.
- Try-with-resources (`try (var r = new Resource()) { ... }`)
- Diamond operator (`List<String> list = new ArrayList<>()`)
- `String` in `switch`
- `Fork/Join` framework
- NIO.2 (better file I/O with `Path`, `Files`)

> **Why `invokedynamic` matters for Scala**: It gave the JVM a mechanism to efficiently support things that don't map directly to Java's class model. Since Scala 2.12, the compiler uses it for lambda encoding, and it's the foundation for many optimizations. We'll cover this in [Chapter 5](../part-2-jvm-architecture/05-bytecode.md).

### Java 8 (2014) — Java Catches Up <span class="since">LTS</span>

The biggest release since Java 5, and the one where Java started borrowing from Scala:

- **Lambda expressions** — `(x) -> x * 2`
  - *Scala had this since day one: `(x: Int) => x * 2`*
- **Method references** — `String::toUpperCase`
- **Streams API** — Functional-style collection processing: `list.stream().filter(...).map(...).collect(...)`
  - *Scala had `map`, `filter`, `collect` on collections since 2004*
- **`Optional<T>`** — A container that may or may not hold a value
  - *Scala's `Option[T]`*
- **Default methods in interfaces** — Interfaces can now have method implementations
  - *Scala traits had concrete methods since the beginning*
- **New Date/Time API** — `java.time` (based on Joda-Time)
- **Metaspace replaces PermGen** — Class metadata now lives in native memory instead of a fixed-size JVM area (no more `PermGen OutOfMemoryError`!)

> **This release was a watershed moment.** Millions of Java developers started writing in a more functional style — something Scala developers had been doing for a decade. The irony was not lost on the Scala community.

> **Scala 2.11 (2014)** focused on performance and modularization. Then **Scala 2.12 (2016)** went all-in on Java 8: it requires Java 8, compiles Scala lambdas to the same `invokedynamic` form as Java lambdas, and compiles traits to interfaces with default methods. Java's features became Scala's implementation tools.

## The Six-Month Train (2017–2023)

Starting with Java 9, Oracle switched to a **six-month release cycle**, with a **long-term support (LTS)** release every few years (every two years since Java 17). No more waiting five years between versions.

<p class="timeline-title">Long-term support releases</p>
<ol class="timeline">
<li><span class="when">2014</span><strong>Java 8</strong></li>
<li><span class="when">2018</span><strong>Java 11</strong></li>
<li><span class="when">2021</span><strong>Java 17</strong></li>
<li><span class="when">2023</span><strong>Java 21</strong></li>
<li><span class="when">2025</span><strong>Java 25</strong></li>
<li><span class="when">2027</span><strong>Java 29, the next LTS</strong></li>
</ol>

### Java 9 (2017) — Modularity

- **Module System (JPMS / Project Jigsaw)** — Organize code into modules with explicit dependencies and encapsulation. The JDK itself was split into dozens of modules (more in [Chapter 23](../part-7-ecosystem/23-module-system.md)).
- **G1 becomes the default garbage collector** on server-class machines, replacing Parallel GC
- **JShell** — Interactive REPL for Java (Scala had the `scala` REPL since forever)
- Reactive Streams (`Flow` API)
- Private methods in interfaces
- Collection factory methods: `List.of(1, 2, 3)`, `Map.of("a", 1)`

### Java 10 (2018) — Local Type Inference

- **`var` for local variables** — `var list = new ArrayList<String>()`
  - *Scala had type inference from the start. But Java's `var` is purely local — no `var` for fields, method parameters, or return types*
- Application Class-Data Sharing — share pre-parsed class metadata between JVM runs for faster startup (the distant ancestor of today's AOT cache)
- G1 gets a parallel full GC

### Java 11 (2018) — The New Baseline <span class="since">LTS</span>

- `var` in lambda parameters
- `String` new methods: `isBlank()`, `strip()`, `lines()`, `repeat()`
- `HttpClient` API (standardized)
- **Single-file source execution**: `java Hello.java` (no separate `javac` step needed)
- **JFR (Java Flight Recorder)** open-sourced — previously a commercial Oracle JDK feature
- ZGC (experimental)
- Removal of Java EE and CORBA modules

> **Scala 2.13 (2019)**: Major collections redesign. The new collections library was simpler, more consistent, and had better lazy evaluation. This was the last major Scala 2 release before Scala 3 (and it is still maintained).

### Java 12–13 (2019) — Preview Features

- Switch expressions (preview): `var result = switch (x) { case 1 -> "one"; ... };`
- Text blocks (preview): multi-line strings with `"""`
  - *Scala had multi-line strings from the start, and string interpolation (`s"Hello $name"`) since Scala 2.10*
- Shenandoah GC (experimental)

### Java 14 (2020) — Records Preview

- **Records (preview)** — Immutable data carriers: `record Point(int x, int y) {}`
  - *Scala's `case class Point(x: Int, y: Int)` since 2004. Same idea: auto-generated `equals`, `hashCode`, `toString`, accessors*
- **Pattern matching for `instanceof` (preview)**: `if (obj instanceof String s) { use(s); }`
  - *Scala had pattern matching from the start, far more powerful*
- Helpful NullPointerExceptions (tells you *which* reference was null)
- `switch` expressions finalized
- CMS garbage collector removed

### Java 15–16 (2020–2021)

- **Sealed classes (preview)** — Restrict which classes can extend a class
  - *Scala's `sealed trait` since the beginning*
- **Records finalized** (Java 16)
- **Pattern matching for `instanceof` finalized** (Java 16)
- Text blocks finalized (Java 15)
- ZGC and Shenandoah production-ready (Java 15)
- `Stream.toList()` (finally, a simple terminal operation!)
- Foreign memory access API (incubator) — early Project Panama

### Java 17 (2021) — The Modern Baseline <span class="since">LTS</span>

- **Sealed classes finalized**
- Strong encapsulation of JDK internals: the `--illegal-access` escape hatch is gone, so reflective access to internal classes needs explicit `--add-opens` (the critical `sun.misc.Unsafe` stays reachable, for now)
- Security Manager deprecated for removal
- New macOS rendering pipeline
- Foreign Function & Memory API (incubator)
- Pattern matching for `switch` (first preview)

> **Scala 3.0 (2021)**: Released the same year as Java 17! A complete redesign of the language:
> - New syntax (optional braces, `then`/`do`/`end`)
> - `given`/`using` replacing `implicit`
> - Enum types
> - Union types, intersection types
> - Match types (compile-time type computation)
> - Metaprogramming with inline/macros
> - Still compiles to the same JVM bytecode
>
> **Scala 3.3 (2023)** became the first Scala 3 LTS release.

### Java 18–20 (2022–2023)

- Simple web server (`jwebserver` command)
- Code snippets in Javadoc
- UTF-8 by default
- **Virtual threads (preview)** — Project Loom
- **Structured concurrency (incubator)**
- **Scoped values (incubator)** — Thread-local replacement
- **Pattern matching for `switch` (preview iterations)**
- Record patterns (preview) — destructuring records in pattern matching

### Java 21 (2023) — Virtual Threads Land <span class="since">LTS</span>

The most important LTS since Java 11:

- **Virtual threads (finalized)** — Lightweight threads (millions of them), scheduled by the JVM onto a small pool of OS threads
  - *This is the JVM's answer to Go's goroutines, Kotlin's coroutines, and Scala's Cats Effect fibers/ZIO fibers*
- **Pattern matching for `switch` (finalized)**
- **Record patterns (finalized)** — Destructuring: `case Point(int x, int y) ->`
  - *Scala had `case Point(x, y) =>` from the start via `unapply`*
- **Sequenced collections** — `SequencedCollection`, `SequencedSet`, `SequencedMap` interfaces
- **Generational ZGC** (opt-in with `-XX:+ZGenerational`)
- Structured concurrency and scoped values (preview)
- Key Encapsulation Mechanism API

## The Current Era (2024–2027)

Since Java 21 the pace hasn't slowed. Four big runtime projects are now landing piece by piece: **Panama** (native interop), **Loom** (concurrency), **Leyden** (startup and warm-up), and **Lilliput** (smaller objects), with **Valhalla** (value objects) right behind them. A second theme runs through every release: *integrity by default*, closing the back doors (`sun.misc.Unsafe`, unrestricted JNI, mutating `final` fields) that libraries have used for decades.

### Java 22 (March 2024)

- **Foreign Function & Memory API (final)** — Project Panama: call native code and manage off-heap memory safely, no JNI needed (see [Chapter 24](../part-7-ecosystem/24-native-interop.md))
- **Unnamed variables and patterns** — `catch (NumberFormatException _)`, `case Point(var x, _) ->`
  - *Scala's `_` wildcard since forever*
- **Launch multi-file source programs** — `java Main.java` now finds and compiles the other `.java` files it uses
- Region pinning for G1: JNI critical regions no longer stall garbage collection
- Previews: statements before `super(...)`, Stream Gatherers, the Class-File API, implicitly declared classes

### Java 23 (September 2024)

- **Markdown documentation comments** — write Javadoc with `///` and Markdown instead of HTML
- **ZGC is generational by default**
- `sun.misc.Unsafe` memory-access methods deprecated for removal
- Previews: primitive types in patterns, module import declarations, flexible constructor bodies
- **String templates withdrawn** — after two previews (21, 22), the feature was pulled for a redesign and isn't in Java 23 at all
  - *Scala's `s"Hello $name"` has been around since 2013. Java tried, found issues, and went back to the drawing board*

### Java 24 (March 2025)

- **Stream Gatherers (final)** — custom intermediate stream operations such as windows and running scans
  - *Scala collections had `sliding`, `grouped` and `scanLeft` built in from the start*
- **Class-File API (final)** — `java.lang.classfile`, a standard library for reading and writing bytecode
- **Virtual threads no longer pin on `synchronized`** — a big blocker for Loom adoption, gone
- **Ahead-of-Time class loading and linking** — the first Project Leyden feature: an *AOT cache* recorded in a training run makes later starts faster
- **Compact object headers (experimental)** — Project Lilliput
- **Security Manager permanently disabled**; warnings for JNI use and for `sun.misc.Unsafe` memory access
- ZGC's non-generational mode removed; generational Shenandoah (experimental)
- Quantum-resistant cryptography: ML-KEM and ML-DSA

> **Meanwhile, in Scala land**: those `Unsafe` warnings hit home, because Scala 3's `lazy val` was implemented with `sun.misc.Unsafe`. **Scala 3.8** (early 2026) moved lazy vals off it, rebuilt the standard library with Scala 3, and raised the minimum JDK to 17.

### Java 25 (September 2025) <span class="since">LTS</span>

The current LTS, and a big one:

- **Compact source files and instance main methods** — a whole program can be `void main() { IO.println("Hello"); }`, with the new `java.lang.IO` class
  - *Scala 3 has had top-level `@main def` since 3.0*
- **Module import declarations** — `import module java.base;` imports every package a module exports
- **Flexible constructor bodies** — statements (validation, computing arguments) before `super(...)` or `this(...)`
- **Scoped values (final)** — immutable, inheritable per-thread context, the modern alternative to `ThreadLocal`
- **Leyden, round two** — one-step AOT cache creation (`-XX:AOTCacheOutput=app.aot`), and method profiles stored in the cache so the JIT warms up faster
- **Compact object headers become a product feature** (still opt-in with `-XX:+UseCompactObjectHeaders`)
- **Generational Shenandoah becomes a product feature**
- Key Derivation Function API (final); JFR CPU-time profiling (experimental, Linux)
- 32-bit x86 port removed
- Previews: Structured concurrency gets a new API (`StructuredTaskScope.open()` with `Joiner`s), Stable Values

### Java 26 (March 2026)

- **Prepare to make `final` mean final** — the JVM now warns when deep reflection mutates a `final` field; a future release will deny it by default
  - *Every Scala `val` field is a `final` field, so this matters for serialization libraries that poke values into case classes*
- **Applet API removed** — the end of an era that began in 1995
- **AOT cache works with any GC**, including ZGC
- **HTTP/3** support in the `HttpClient` API
- G1 throughput improved by reducing synchronization
- Previews: Stable Values renamed to **Lazy Constants**, structured concurrency (6th), primitive patterns (4th)

### Java 27 (September 2026) <span class="since">Current</span>

- **G1 is the default garbage collector everywhere** — previously the JVM quietly picked Serial GC on small machines (1 CPU or less than about 1.8 GB of RAM), which surprised many people running in small containers
- **Compact object headers by default** — object headers shrink from 12 to 8 bytes on 64-bit platforms; less heap, less GC work (see [Chapter 8](../part-3-memory-and-gc/08-object-layout.md))
- Post-quantum hybrid key exchange for TLS 1.3
- JFR in-process data redaction
- Previews: Lazy Constants (3rd), structured concurrency (7th), primitive patterns (5th); the Vector API is in its 12th incubator, waiting for Valhalla

Lazy Constants are worth a quick look, because they will feel very familiar:

```java
class OrderController {
    private final LazyConstant<Logger> logger
        = LazyConstant.of(() -> Logger.create(OrderController.class));

    void submitOrder(User user, List<Product> products) {
        logger.get().info("order started");   // computed once, on first use
    }
}
```

```scala
class OrderController:
  private lazy val logger = Logger.create(classOf[OrderController])

  def submitOrder(user: User, products: List[Product]): Unit =
    logger.info("order started")
```

> **Scala parallel**: `LazyConstant` is Java's `lazy val`, as a library type rather than a keyword. The JVM can even treat the value as a true constant once it's set, and constant-fold it in JIT-compiled code.

> **Meanwhile, in Scala land**: **Scala 3.9 LTS** shipped in September 2026, succeeding 3.3 as the long-term support line.

## Coming in JDK 28 (March 2027)

> [!WARNING]
> JDK 28 is still in development. The list below is what has been targeted or proposed as of September 2026; details can change before release.

- **Value Objects (preview)** — the first Project Valhalla feature to ship. A `value class` or `value record` has no identity: `==` compares field values, and the JVM is free to flatten it into arrays and fields. With preview enabled, classes like `Integer`, `Optional` and `LocalDate` become value classes. See [Chapter 14](../part-4-type-system/14-value-types-valhalla.md).
  - *Scala's `AnyVal` value classes and `opaque type`s have faked this at compile time; Valhalla makes it a real JVM feature, with any number of fields*
- Strict field initialization in the JVM (preview) — a building block for Valhalla
- **A simple JSON API** (incubator) in the JDK
- Shenandoah runs in generational mode by default
- PEM encodings of cryptographic objects (final)
- macOS/x64 port deprecated for removal
- Proposed: **Ahead-of-Time code compilation** — Leyden's next step: store JIT-compiled native code in the AOT cache, so an application starts *and* runs fast from the first second

What a value record looks like (JDK 28 with `--enable-preview`):

```java
value record Point(int x, int y) {}

var a = new Point(1, 2);
var b = new Point(1, 2);
IO.println(a == b);   // true: compared by value, no identity
```

## The Big Projects at a Glance

| Project      | Goal                                         | Status (September 2026)                                                      | Scala parallel             |
| ------------ | -------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------- |
| **Loom**     | Cheap threads, structured concurrency        | Virtual threads final (21), scoped values final (25), structured concurrency in preview | Cats Effect / ZIO fibers, Ox |
| **Panama**   | Native interop, SIMD                         | FFM API final (22), Vector API still incubating                              | Scala Native (different approach) |
| **Leyden**   | Faster startup and warm-up                   | AOT cache since 24, extended in 25 and 26; AOT code proposed for 28          | GraalVM Native Image       |
| **Lilliput** | Smaller object headers                       | Compact headers experimental (24), product (25), default (27); 4-byte headers next | Benefits all JVM languages |
| **Valhalla** | Value objects: no identity, stored inline    | Value Objects preview in 28                                                  | `AnyVal`, `opaque type`    |
| **Babylon**  | Code reflection: Java code as data           | Incubator proposed, not in a release yet                                     | Scala 3 macros, `inline`   |

## The Big Picture: Who Influenced Whom?

| Scala feature                         | Scala since     | Java counterpart                          | Java since              |
| ------------------------------------- | --------------- | ----------------------------------------- | ----------------------- |
| First-class functions                 | 2004            | Lambda expressions                        | 8 (2014)                |
| Traits with implementations           | 2004            | Default methods                           | 8 (2014)                |
| `Option`                              | early Scala     | `Optional`                                | 8 (2014)                |
| Type inference                        | 2004            | `var` for locals                          | 10 (2018)               |
| Case classes                          | 2004            | Records                                   | 16 (2021)               |
| Sealed traits                         | early Scala     | Sealed classes                            | 17 (2021)               |
| Pattern matching                      | 2004            | `instanceof`, `switch` and record patterns | 16–21 (2021–2023)      |
| `_` wildcard                          | 2004            | Unnamed variables and patterns            | 22 (2024)               |
| Top-level `@main def`                 | 3.0 (2021)      | Compact source files                      | 25 (2025)               |
| `lazy val`                            | Scala 2         | Lazy Constants                            | preview since 26 (2026) |
| `AnyVal` classes, `opaque type`       | 2.10 (2013), 3.0 (2021) | Value classes                     | preview in 28 (2027)    |
| String interpolation                  | 2.10 (2013)     | String templates                          | withdrawn after 22      |
| For-comprehensions                    | 2004            | Streams and Gatherers fill part of the gap | —                      |
| Givens / implicits, higher-kinded types | 2004 / 3.0    | No equivalent                             | —                       |

This is **not** to diminish Java. Java's massive ecosystem, stability, and backward compatibility are why the JVM is the platform it is. And the influence flows the other way too:

- **Java 8** gave Scala 2.12 its lambda and trait encodings.
- **Virtual threads** power direct-style Scala libraries such as Ox, and make blocking code cheap for every JVM language.
- The **integrity-by-default** push moved Scala 3.8 off `sun.misc.Unsafe`.
- **Leyden** and **Lilliput** make every Scala service start faster and use less memory without a single code change.

The relationship is symbiotic: **Scala pushes boundaries, Java mainstreams the best ideas, and the JVM improves under both.**

<div class="takeaways">

## Key Takeaways

- The JVM evolved from a slow interpreter (1996) to one of the fastest runtimes in existence
- **HotSpot** (1999) introduced adaptive JIT compilation — still the foundation today
- **`invokedynamic`** (Java 7, 2011) opened the JVM to non-Java languages
- **Java 8** (2014) was the functional revolution — inspired by Scala's features from 2004
- Since Java 9 (2017), releases happen every 6 months, with an LTS every 2 years since Java 17: **Java 25** is the current LTS, **Java 27** the current release
- **Java 21** (2023) brought virtual threads — the biggest concurrency change since 1998
- Java 22–27 landed FFM, the AOT cache, compact object headers (default in 27) and G1 everywhere; **Valhalla's value objects** arrive as a preview in Java 28
- Scala and Java have a **symbiotic relationship**: Scala pioneers, Java mainstreams, the JVM benefits

</div>
