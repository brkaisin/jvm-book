# Part V — Concurrency and Threading

Concurrency is where the JVM really shines, and it's also where the most subtle bugs live. This part covers the threading model, the memory model that governs how threads see each other's changes, the concurrency toolbox, and virtual threads from Project Loom, which are now a mature part of the platform.

| Chapter                                                     | Topic                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| [15. Threads on the JVM](15-threads.md)                     | Platform threads, lifecycle, monitors and locking              |
| [16. The Java Memory Model](16-java-memory-model.md)        | Happens-before, visibility, and why `val` is your friend       |
| [17. java.util.concurrent — The Toolbox](17-juc-toolbox.md) | Executors, futures, locks, atomics                             |
| [18. Virtual Threads (Project Loom)](18-virtual-threads.md) | Millions of threads, scoped values, structured concurrency     |

> [!NOTE]
> Where Loom stands in September 2026: virtual threads have been final since Java 21. Since Java 24, `synchronized` no longer pins them (JEP 491). Scoped values became final in Java 25. Structured concurrency is still a preview API (its 7th preview is in Java 27).
