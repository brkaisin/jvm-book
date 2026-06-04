# Part V — Concurrency and Threading

Concurrency is where the JVM really shines — and where the most subtle bugs live. This part covers the threading model, the memory model that governs how threads see each other's changes, the rich concurrency toolbox, and the revolutionary virtual threads from Project Loom.

| Chapter                                                     | Topic                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| [15. Threads on the JVM](15-threads.md)                     | OS threads, lifecycle, synchronization                   |
| [16. The Java Memory Model](16-java-memory-model.md)        | Happens-before, visibility, and why `val` is your friend |
| [17. java.util.concurrent — The Toolbox](17-juc-toolbox.md) | Executors, futures, locks, atomics                       |
| [18. Virtual Threads (Project Loom)](18-virtual-threads.md) | Millions of threads, no sweat                            |

[← Back to main index](../index.md) · [← Part IV](../part-4-type-system/index.md)
