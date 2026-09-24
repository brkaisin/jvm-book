# Part VI — Performance, Monitoring, and Tooling

Knowing how the JVM works is one thing. Diagnosing and optimizing a live application is another. This part covers the JIT compiler's deep optimizations, the ahead-of-time techniques that fix startup and warmup (Project Leyden's AOT cache and GraalVM Native Image), the monitoring tools at your disposal, and the performance pitfalls that trip up even experienced developers.

| Chapter                                                                  | Topic                                                    |
| ------------------------------------------------------------------------ | -------------------------------------------------------- |
| [19. JIT Compilation Deep Dive](19-jit-deep-dive.md)                     | Tiers, inlining, escape analysis, deoptimization, AOT profiles |
| [20. Ahead-of-Time: Project Leyden and GraalVM Native Image](20-graalvm.md) | AOT cache, training runs, native binaries, Graal and Truffle |
| [21. Monitoring and Diagnostics](21-monitoring.md)                       | jcmd, JFR (new in 25–27), async-profiler, heap dumps, NMT |
| [22. Common Performance Pitfalls](22-performance-pitfalls.md)            | Autoboxing, megamorphic calls, Scala traps, modern JVM surprises |
