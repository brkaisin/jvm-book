# Chapter 26 — What's Next for the JVM

[← Previous: Language Ecosystem](25-language-ecosystem.md) · [Next: Appendices →](../appendices/index.md)

---

## The Active Projects

The JVM is under active, ambitious development. Several major projects are reshaping the platform. Here's where things stand and where they're headed.

## Project Valhalla — Value Types

**Goal**: Allow user-defined types that behave like primitives — no object header, no identity, inline storage.

**Status**: In active development, with preview features appearing in recent Java releases.

**What it solves**:
- The 16-byte overhead per object (see [Chapter 8](../part-3-memory-and-gc/08-object-layout.md))
- Boxing of primitives in generics (`List<Integer>` → `List<int>`)
- Poor cache locality for arrays of small objects

**What it delivers**:
- **Value classes**: Classes without identity — `==` compares fields, not references. No `synchronized`, no `identityHashCode`.
- **Null-restricted types**: Types that can never be null.
- **Eventually**: Generic specialization — `List<int>` stores raw integers, not boxed `Integer`.

**Impact on Scala**: This is transformative. Scala's `opaque type`, `AnyVal`, and workarounds for boxing could all be replaced by (or optimized to use) JVM-level value types. Generic collections of primitives without boxing would benefit every Scala application.

## Project Loom — Lightweight Concurrency

**Goal**: Lightweight threads and structured concurrency.

**Status**: Virtual threads finalized in Java 21. Structured concurrency and scoped values in preview/finalized (Java 24).

**What it solved**:
- The 1:1 thread = OS thread limitation (see [Chapter 18](../part-5-concurrency/18-virtual-threads.md))
- The complexity of async/reactive programming models

**What's still coming**:
- **Structured concurrency** finalization — ensuring task lifetimes are well-scoped
- **Scoped values** finalization — replacing `ThreadLocal` for virtual threads
- Improved tooling (virtual thread dumps, debugger integration)

**Impact on Scala**: Virtual threads complement rather than replace Cats Effect / ZIO. Effect systems provide stronger compositional guarantees, but virtual threads simplify the common case. Libraries are already adapting to leverage virtual threads as carrier mechanisms.

## Project Panama — Foreign Function & Memory

**Goal**: Replace JNI with safe, efficient native interop.

**Status**: Foreign Function & Memory API finalized in Java 22. Vector API in incubation.

**What it delivers**:
- **Foreign Function API**: Call C/C++ functions from Java without writing C code
- **Foreign Memory API**: Safely allocate and access native memory
- **jextract**: Generate Java bindings from C headers automatically

**What's still coming**:
- **Vector API (SIMD)**: Portable access to CPU vector instructions (SSE, AVX, NEON). Currently in incubation.
  ```java
  // Vector API — process 8 ints at once
  var va = IntVector.fromArray(SPECIES_256, a, 0);
  var vb = IntVector.fromArray(SPECIES_256, b, 0);
  var vc = va.mul(vb).add(va);
  vc.intoArray(c, 0);
  ```

**Impact on Scala**: Direct C interop from Scala without JNI. Libraries like Apache Arrow, TensorFlow, and OpenSSL can be called efficiently. The Vector API will benefit numerical Scala code.

## Project Leyden — Faster Startup

**Goal**: Address the JVM's slow startup by allowing ahead-of-time work to be "shifted left" (done before runtime).

**Status**: Early development, with some features appearing in recent releases.

**Approach**: Rather than GraalVM Native Image's all-or-nothing AOT, Leyden takes a **spectrum approach** — you choose how much to pre-compute:

```
Full JIT (today)                                    Full AOT (Native Image)
├──────────────────────────────────────────────────────┤
│ CDS  → Condensed  → Pre-compiled  → AOT Classes  → │
│        Archive       Methods                        │
│                                                     │
│  More flexible ──────────────────────── More static │
│  Full compatibility ────────── Restricted but faster │
```

**Key features**:
- **CDS (Class Data Sharing)**: Pre-process class metadata into a shared archive. Already available.
- **Condensed archives**: Store pre-linked, pre-verified class data.
- **Pre-compiled methods**: Cache JIT-compiled code for reuse across runs.

**Impact on Scala**: Faster startup without GraalVM Native Image's closed-world limitations. Scala applications (which load many classes) benefit significantly from CDS.

```bash
# Already available: CDS archive for faster startup
java -XX:ArchiveClassesAtExit=myapp-cds.jsa -jar myapp.jar  # Training run
java -XX:SharedArchiveFile=myapp-cds.jsa -jar myapp.jar      # Fast startup!
```

## Project Lilliput — Smaller Object Headers

**Goal**: Reduce the object header from 12 bytes (mark word + compressed class pointer) to 8 bytes.

**Status**: Experimental, available since Java 22 with flags.

**How**: Compress the mark word and class pointer into a single 64-bit value. The class pointer goes into a table, referenced by a small index.

```
Current header:  mark word (8 bytes) + klass pointer (4 bytes) = 12 bytes + padding = 16 bytes
Lilliput:        combined header (8 bytes) = 8 bytes minimum (with possible padding to 8-byte alignment)
```

**Impact**: 4 bytes saved per object. For an application with 10 million objects, that's 40 MB. For heap-intensive applications (like those using Scala's immutable data structures), the savings compound.

## Project Babylon — Code Reflection

**Goal**: Allow Java programs to access their own code as data — an API for code reflection (not just type reflection).

**Think of it as**: Macros / compile-time code manipulation for Java.

```java
// Conceptual (syntax TBD)
var code = Code.of((int x, int y) -> x + y);
// 'code' is a data structure representing the lambda's AST
// You can transform, optimize, or translate it
```

**Use cases**:
- GPU programming (translate Java code to GPU kernels)
- Database queries (translate Java lambdas to SQL — like C#'s LINQ)
- Automatic differentiation (for ML)
- Serialization of behavior (not just data)

**Impact on Scala**: Scala 3 already has `inline`, `compiletime`, and macros for compile-time code manipulation. Babylon brings similar capabilities to the JVM level, which could benefit all JVM languages.

## The Bigger Trend

Looking at all these projects together, a clear trend emerges:

```
1995-2010: JVM provides the basics (GC, JIT, threading)
           Languages adapt to fit the JVM's constraints

2010-2020: Languages push boundaries, JVM slowly adapts
           invokedynamic, default methods, lambdas

2020-2030: JVM actively evolves to serve ALL languages better
           Value types, virtual threads, native interop, code reflection
```

The JVM is becoming a more **universal platform** — not just "Java's runtime" but a runtime that genuinely serves Scala, Kotlin, and other languages as first-class citizens. Features like value types and universal generics will erase performance penalties that Scala has worked around for two decades.

## What This Means for Your Scala Code

| Project      | When it lands            | What changes for you                                        |
| ------------ | ------------------------ | ----------------------------------------------------------- |
| **Valhalla** | Gradually (years)        | `case class Point(x: Int, y: Int)` could be truly zero-cost |
| **Loom**     | Available now (Java 21+) | Simpler blocking I/O, CE/ZIO can leverage virtual threads   |
| **Panama**   | Available now (Java 22+) | Easy C interop without JNI, SIMD via Vector API             |
| **Leyden**   | Gradually                | Faster startup without GraalVM Native Image limitations     |
| **Lilliput** | Coming soon              | All objects smaller → less memory, better cache performance |
| **Babylon**  | Research phase           | New metaprogramming possibilities                           |

The JVM is not standing still. It's evolving faster than at any point in its 30-year history, and Scala is positioned to benefit from every advancement.

## Key Takeaways

- **Valhalla**: Value types and universal generics — the biggest change to the JVM object model ever
- **Loom**: Virtual threads are here (Java 21); structured concurrency is being finalized
- **Panama**: Native interop without JNI is here (Java 22); Vector API (SIMD) is coming
- **Leyden**: Faster startup through a spectrum of AOT techniques (not all-or-nothing like Native Image)
- **Lilliput**: Smaller object headers — 4 bytes saved per object
- **Babylon**: Code reflection — Java's answer to macros and LINQ
- The JVM is evolving from "Java's runtime" to a **universal platform** for all JVM languages

---

[← Previous: Language Ecosystem](25-language-ecosystem.md) · [Next: Appendices →](../appendices/index.md)
