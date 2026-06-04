# Chapter 3 — A Timeline of the JVM

[← Previous: From Source Code to Execution](02-from-source-to-execution.md) · [Next: Part II — JVM Architecture →](../part-2-jvm-architecture/index.md)

---

## 30 Years of Evolution

The JVM has changed dramatically since its birth in 1995. What started as a slow interpreter for web applets is now one of the most sophisticated runtime platforms in existence. Let's walk through the major milestones — and see how Scala and the JVM evolved together.

## The Early Years (1995–2002)

### Java 1.0 (1996) — The Birth

The first public release. The JVM was a **pure interpreter** — it read bytecode instruction by instruction and executed each one. No JIT compilation. Performance was… not great.

Key features:
- Bytecode interpreter
- Green threads (user-space threads, not real OS threads)
- Garbage collection (a simple mark-sweep collector)
- Security model with the SecurityManager
- AWT for GUI

> **Historical context**: Java launched with the promise of running in web browsers (Java applets). The JVM was embedded in Netscape Navigator. It was slow, but it *worked* across platforms.

### Java 1.1 (1997) — Growing Up

- Inner classes
- JDBC (database connectivity)
- Reflection API — inspect classes, methods, and fields at runtime
- RMI (Remote Method Invocation)

### Java 1.2 (1998) — "Java 2"

A major release that transformed the platform:

- **JIT compilation** — The JVM now compiles hot bytecode to native machine code at runtime. Massive performance improvement.
- **Native OS threads** — Green threads replaced by real operating system threads. Each `Thread` in Java now maps to an OS thread (this remained true until Project Loom in Java 21, over 20 years later!)
- Collections framework (`ArrayList`, `HashMap`, etc.)
- Swing GUI toolkit
- The "Java 2 Platform" branding (J2SE, J2EE, J2ME)

### Java 1.3 (2000)

- **HotSpot JVM** becomes the default — this is the JVM we still use today (in evolved form)
- HotSpot introduced *adaptive optimization*: it profiles your running code and optimizes the hot paths
- JNDI (naming and directory)

### Java 1.4 (2002)

- `assert` keyword
- NIO (non-blocking I/O) — `java.nio` package
- Regular expressions (`java.util.regex`)
- XML parsing
- Logging API

> **Meanwhile, in Scala land**: Martin Odersky, who had previously worked on Generic Java (which became Java generics) and the Pizza language, started designing Scala in 2001 at EPFL. The first Scala release would come in 2004.

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
> - Pattern matching (Java's preview: Java 14, in 2020)
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

> **Why `invokedynamic` matters for Scala**: It gave the JVM a mechanism to efficiently support things that don't map directly to Java's class model. Scala's compiler uses it for lambda encoding, and it's the foundation for many optimizations. We'll cover this in [Chapter 5](../part-2-jvm-architecture/05-bytecode.md).

### Java 8 (2014) — Java Catches Up

The biggest release since Java 5, and the one where Java started borrowing from Scala:

- **Lambda expressions** — `(x) -> x * 2`
  - *Scala had this since day one: `(x: Int) => x * 2`*
- **Method references** — `String::toUpperCase`
- **Streams API** — Functional-style collection processing: `list.stream().filter(...).map(...).collect(...)`
  - *Scala had `map`, `filter`, `collect` on collections since 2004*
- **`Optional<T>`** — A container that may or may not hold a value
  - *Scala's `Option[T]` since 2004*
- **Default methods in interfaces** — Interfaces can now have method implementations
  - *Scala traits had concrete methods since the beginning*
- **New Date/Time API** — `java.time` (based on Joda-Time)
- **Metaspace replaces PermGen** — Class metadata now lives in native memory instead of a fixed-size JVM area (no more `PermGen OutOfMemoryError`!)

> **This release was a watershed moment.** Millions of Java developers started writing in a more functional style — something Scala developers had been doing for a decade. The irony was not lost on the Scala community.

> **Scala 2.11 (2014)**: Focused on performance and modularization. The Scala compiler itself was being modernized.

## The Modern Era (2017–Present)

Starting with Java 9, Oracle switched to a **six-month release cycle**. No more waiting five years between versions.

### Java 9 (2017) — Modularity

- **Module System (JPMS / Project Jigsaw)** — Organize code into modules with explicit dependencies and encapsulation. The JDK itself was modularized into ~70 modules.
- **JShell** — Interactive REPL for Java (Scala had `scala` REPL since forever)
- Reactive Streams (`Flow` API)
- Private methods in interfaces
- Collection factory methods: `List.of(1, 2, 3)`, `Map.of("a", 1)`

### Java 10 (2018) — Local Type Inference

- **`var` for local variables** — `var list = new ArrayList<String>()`
  - *Scala had type inference from the start. But Java's `var` is purely local — no `var` for method parameters or return types*
- G1 GC becomes the default (replacing Parallel GC)

### Java 11 (2018, LTS) — The New Baseline

- `var` in lambda parameters
- `String` new methods: `isBlank()`, `strip()`, `lines()`, `repeat()`
- `HttpClient` API (standardized)
- **Single-file source execution**: `java Hello.java` (no separate `javac` step needed)
- **JFR (Java Flight Recorder)** open-sourced — previously a commercial Oracle JDK feature
- Removal of Java EE and CORBA modules

> **Scala 2.13 (2019)**: Major collections redesign. The new collections library was simpler, more consistent, and had better lazy evaluation. This was the last major Scala 2 release before Scala 3.

### Java 12–13 (2019) — Preview Features

- Switch expressions (preview): `var result = switch (x) { case 1 -> "one"; ... };`
- Text blocks (preview): multi-line strings with `"""`
  - *Scala had string interpolation (`s"Hello $name"`) and multi-line strings since Scala 2.10*
- ZGC improvements (experimental)
- Shenandoah GC (experimental)

### Java 14 (2020) — Records Preview

- **Records (preview)** — Immutable data carriers: `record Point(int x, int y) {}`
  - *Scala's `case class Point(x: Int, y: Int)` since 2004. Same idea: auto-generated `equals`, `hashCode`, `toString`, accessors*
- **Pattern matching for `instanceof` (preview)**: `if (obj instanceof String s) { use(s); }`
  - *Scala had pattern matching from the start, far more powerful*
- Helpful NullPointerExceptions (tells you *which* reference was null)
- `switch` expressions finalized

### Java 15–16 (2020–2021)

- **Sealed classes (preview → final in 16)** — Restrict which classes can extend a class
  - *Scala's `sealed trait` since the beginning*
- Records finalized (Java 16)
- Text blocks finalized
- ZGC production-ready
- `Stream.toList()` (finally, a simple terminal operation!)
- Foreign memory access API (incubator) — early Project Panama

### Java 17 (2021, LTS) — The Modern Baseline

- **Sealed classes finalized**
- **Pattern matching for `instanceof` finalized**
- Strong encapsulation of JDK internals (can't use `sun.misc.Unsafe` without flags)
- Removal of the Security Manager (deprecated for removal)
- New macOS rendering pipeline
- Foreign Function & Memory API (incubator)

> **Scala 3.0 (2021)**: Released the same year as Java 17! A complete redesign of the language:
> - New syntax (optional braces, `then`/`do`/`end`)
> - `given`/`using` replacing `implicit`
> - Enum types
> - Union types, intersection types
> - Match types (compile-time type computation)
> - Metaprogramming with inline/macros
> - Still compiles to the same JVM bytecode

### Java 18–20 (2022–2023)

- Simple web server (`jwebserver` command)
- Code snippets in Javadoc
- **Virtual threads (preview)** — Project Loom
- **Structured concurrency (incubator)**
- **Scoped values (incubator)** — Thread-local replacement
- **Pattern matching for `switch` (preview iterations)**
- Record patterns (destructuring records in pattern matching)

### Java 21 (2023, LTS) — Virtual Threads Land

The most important LTS since Java 11:

- **Virtual threads (finalized)** — Lightweight threads (millions of them), scheduled by the JVM onto a small pool of OS threads
  - *This is the JVM's answer to Go's goroutines, Kotlin's coroutines, and Scala's Cats Effect fibers/ZIO fibers*
- **Pattern matching for `switch` (finalized)**
- **Record patterns (finalized)** — Destructuring: `case Point(int x, int y) ->`
  - *Scala had `case Point(x, y) =>` from the start via `unapply`*
- **Sequenced collections** — `SequencedCollection`, `SequencedSet`, `SequencedMap` interfaces
- **Structured concurrency (preview)**
- **Scoped values (preview)**
- Generational ZGC (default mode for ZGC)
- Key encapsulation API

### Java 22–24 (2024–2025)

- **Foreign Function & Memory API (finalized)** — Project Panama: call native code safely, no JNI needed
- **Unnamed variables** — `var _ = expensiveCall()` (discard result)
  - *Scala's `_` wildcard since forever*
- **Statements before `super()`** — Can now run code before calling the super constructor
- **Stream Gatherers** — Custom intermediate stream operations
  - *Scala collections had this flexibility built in from the start*
- **String templates (preview → withdrawn)** — String interpolation for Java
  - *Scala's `s"Hello $name"` since 2013. Java tried, found issues, and withdrew the feature for redesign*
- **Scoped values (finalized in Java 24)**
- **Structured concurrency (preview continues)**
- Compact object headers (Project Lilliput, experimental)

### Beyond Java 24

Active projects still in development:

| Project      | Goal                                                 | Scala parallel             |
| ------------ | ---------------------------------------------------- | -------------------------- |
| **Valhalla** | Value types: objects without identity, stored inline | `AnyVal`, `opaque type`    |
| **Leyden**   | Faster startup via constrained Java                  | GraalVM native image       |
| **Lilliput** | Smaller object headers (64-bit → 32-bit)             | Benefits all JVM languages |
| **Babylon**  | Code reflection — represent Java code as data        | Scala 3 macros, `inline`   |

## The Big Picture: Who Influenced Whom?

```
Scala (2004)                          Java
─────────────                         ────
Type inference ──────────────────────▶ var (2018)
Case classes ────────────────────────▶ Records (2021)
Sealed traits ───────────────────────▶ Sealed classes (2021)
Pattern matching ────────────────────▶ Pattern matching (2020–2023)
Lambdas / first-class functions ─────▶ Lambda expressions (2014)
Traits with implementations ─────────▶ Default methods (2014)
Option ──────────────────────────────▶ Optional (2014)
String interpolation ────────────────▶ String templates (attempted, withdrawn)
Lazy vals ───────────────────────────▶ (no direct equivalent yet)
For-comprehensions ──────────────────▶ (no equivalent — but Streams/Gatherers fill some gap)
Implicits/givens ────────────────────▶ (no equivalent)
Higher-kinded types ─────────────────▶ (no equivalent)
```

This is **not** to diminish Java. Java's massive ecosystem, stability, and backward compatibility are why the JVM is the platform it is. And Java has influenced Scala too — Java's module system, virtual threads, and ongoing performance work benefit *all* JVM languages.

The relationship is symbiotic: **Scala pushes boundaries, Java mainstreams the best ideas, and the JVM improves under both.**

## Key Takeaways

- The JVM evolved from a slow interpreter (1996) to one of the fastest runtimes in existence
- **HotSpot** (1999) introduced adaptive JIT compilation — still the foundation today
- **`invokedynamic`** (Java 7, 2011) opened the JVM to non-Java languages
- **Java 8** (2014) was the functional revolution — inspired by Scala's features from 2004
- Since Java 9 (2017), releases happen every 6 months, with LTS versions every 2 years
- **Java 21** (2023) brought virtual threads — the biggest concurrency change since 1998
- Scala and Java have a **symbiotic relationship**: Scala pioneers, Java mainstreams, the JVM benefits
- Java is still actively adopting Scala-inspired features: records, sealed types, pattern matching, and more

---

[← Previous: From Source Code to Execution](02-from-source-to-execution.md) · [Next: Part II — JVM Architecture →](../part-2-jvm-architecture/index.md)
