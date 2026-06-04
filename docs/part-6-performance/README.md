# Part VI — Performance, Monitoring, and Tooling

Knowing how the JVM works is one thing. Diagnosing and optimizing a live application is another. This part covers the JIT compiler's deep optimizations, GraalVM's AOT approach, the monitoring tools at your disposal, and the performance pitfalls that trip up even experienced developers.

| Chapter                                                       | Topic                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| [19. JIT Compilation Deep Dive](19-jit-deep-dive.md)          | Inlining, escape analysis, speculative optimization     |
| [20. GraalVM and Native Image](20-graalvm.md)                 | AOT compilation, polyglot runtime, native binaries      |
| [21. Monitoring and Diagnostics](21-monitoring.md)            | JFR, async-profiler, heap dumps, flame graphs           |
| [22. Common Performance Pitfalls](22-performance-pitfalls.md) | Autoboxing, megamorphic calls, and Scala-specific traps |

[← Back to main index](../README.md) · [← Part V](../part-5-concurrency/README.md)
