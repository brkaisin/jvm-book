# The JVM — A Gentle Deep Dive

> *For the curious developer who wants to understand the machine under the code*

This book explains the Java Virtual Machine from the ground up — in plain language, with real examples in Java and Scala, and without cutting corners on the concepts. Whether you're a Scala developer who wants to know what happens after `scalac`, or a Java developer curious about the runtime, this is for you.

---

## Table of Contents

### [Part I — The Big Picture](part-1-the-big-picture/README.md)

| #   | Chapter                                                                                | What you'll learn                                                   |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | [Why the JVM Exists](part-1-the-big-picture/01-why-the-jvm-exists.md)                  | The problem it solved, the platform it became                       |
| 2   | [From Source Code to Execution](part-1-the-big-picture/02-from-source-to-execution.md) | The full journey: source → compiler → bytecode → JVM → machine code |
| 3   | [A Timeline of the JVM](part-1-the-big-picture/03-timeline.md)                         | 30 years of evolution, and how Scala and Java influenced each other |

### [Part II — JVM Architecture](part-2-jvm-architecture/README.md)

| #   | Chapter                                                                                | What you'll learn                                   |
| --- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 4   | [The Class Loader Subsystem](part-2-jvm-architecture/04-class-loaders.md)              | How classes are found, loaded, and isolated         |
| 5   | [Bytecode — The JVM's Native Language](part-2-jvm-architecture/05-bytecode.md)         | The instruction set that every JVM language targets |
| 6   | [Runtime Data Areas (Memory Layout)](part-2-jvm-architecture/06-runtime-data-areas.md) | Heap, stack, metaspace — where everything lives     |
| 7   | [The Execution Engine](part-2-jvm-architecture/07-execution-engine.md)                 | Interpreter, JIT compiler, and how code gets fast   |

### [Part III — Memory Management & Garbage Collection](part-3-memory-and-gc/README.md)

| #   | Chapter                                                                       | What you'll learn                                |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| 8   | [Object Layout in Memory](part-3-memory-and-gc/08-object-layout.md)           | What an object actually looks like in RAM        |
| 9   | [Garbage Collection Fundamentals](part-3-memory-and-gc/09-gc-fundamentals.md) | Mark, sweep, compact, copy — the core algorithms |
| 10  | [The Garbage Collectors — A Tour](part-3-memory-and-gc/10-gc-tour.md)         | Serial, Parallel, CMS, G1, ZGC, Shenandoah       |
| 11  | [Tuning the GC](part-3-memory-and-gc/11-gc-tuning.md)                         | Practical flags, logs, and common pitfalls       |

### [Part IV — The Type System at Runtime](part-4-type-system/README.md)

| #   | Chapter                                                                              | What you'll learn                                     |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 12  | [How the JVM Sees Types](part-4-type-system/12-types-at-runtime.md)                  | Primitives, erasure, and the reality behind generics  |
| 13  | [Inheritance and Method Dispatch](part-4-type-system/13-inheritance-and-dispatch.md) | Vtables, itables, and how trait methods actually work |
| 14  | [Value Types and Project Valhalla](part-4-type-system/14-value-types-valhalla.md)    | The future: objects without overhead                  |

### [Part V — Concurrency and Threading](part-5-concurrency/README.md)

| #   | Chapter                                                                    | What you'll learn                                        |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------- |
| 15  | [Threads on the JVM](part-5-concurrency/15-threads.md)                     | OS threads, lifecycle, synchronization                   |
| 16  | [The Java Memory Model](part-5-concurrency/16-java-memory-model.md)        | Happens-before, visibility, and why `val` is your friend |
| 17  | [java.util.concurrent — The Toolbox](part-5-concurrency/17-juc-toolbox.md) | Executors, futures, locks, atomics                       |
| 18  | [Virtual Threads (Project Loom)](part-5-concurrency/18-virtual-threads.md) | Millions of threads, no sweat                            |

### [Part VI — Performance, Monitoring, and Tooling](part-6-performance/README.md)

| #   | Chapter                                                                      | What you'll learn                                       |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| 19  | [JIT Compilation Deep Dive](part-6-performance/19-jit-deep-dive.md)          | Inlining, escape analysis, speculative optimization     |
| 20  | [GraalVM and Native Image](part-6-performance/20-graalvm.md)                 | AOT compilation, polyglot runtime, native binaries      |
| 21  | [Monitoring and Diagnostics](part-6-performance/21-monitoring.md)            | JFR, async-profiler, heap dumps, flame graphs           |
| 22  | [Common Performance Pitfalls](part-6-performance/22-performance-pitfalls.md) | Autoboxing, megamorphic calls, and Scala-specific traps |

### [Part VII — The JVM Ecosystem & Beyond](part-7-ecosystem/README.md)

| #   | Chapter                                                                  | What you'll learn                                    |
| --- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| 23  | [The Module System (JPMS)](part-7-ecosystem/23-module-system.md)         | Strong encapsulation and what it means for Scala     |
| 24  | [JNI, Panama, and Native Interop](part-7-ecosystem/24-native-interop.md) | Calling C from the JVM — the old way and the new way |
| 25  | [The JVM Language Ecosystem](part-7-ecosystem/25-language-ecosystem.md)  | How Scala, Kotlin, Clojure, and others coexist       |
| 26  | [What's Next for the JVM](part-7-ecosystem/26-whats-next.md)             | Valhalla, Leyden, Lilliput — the roadmap             |

### [Appendices](appendices/README.md)

|     | Appendix                                                             | What's inside                            |
| --- | -------------------------------------------------------------------- | ---------------------------------------- |
| A   | [JVM Flags Cheat Sheet](appendices/a-jvm-flags.md)                   | The flags you'll actually use            |
| B   | [Bytecode Instruction Reference](appendices/b-bytecode-reference.md) | Every instruction, grouped and explained |
| C   | [Glossary](appendices/c-glossary.md)                                 | JVM terminology in plain language        |

---

> **How to read this book**: Start from Part I if you're new to the JVM. If you already know the basics, jump to whatever Part interests you — each one is self-contained enough to read independently, with cross-references where needed. Every chapter includes runnable examples in Java and Scala.
