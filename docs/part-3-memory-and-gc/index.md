# Part III — Memory Management & Garbage Collection

Garbage collection is one of the JVM's greatest gifts — and one of its most misunderstood features. In this part, we'll look at how objects are laid out in memory, how the GC finds and reclaims dead objects, what collectors are available, and how to tune them.

This part is also where the JVM has changed the most in recent releases: as of JDK 27, objects have smaller headers by default (compact object headers), G1 is the default collector on *every* machine, including tiny containers, and ZGC and Shenandoah have both gone generational.

| Chapter                                                     | Topic                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| [8. Object Layout in Memory](08-object-layout.md)           | What an object looks like in RAM, old and new headers  |
| [9. Garbage Collection Fundamentals](09-gc-fundamentals.md) | Mark, sweep, compact, copy — the core algorithms       |
| [10. The Garbage Collectors — A Tour](10-gc-tour.md)        | Serial, Parallel, G1, ZGC, Shenandoah, Epsilon (+ CMS) |
| [11. Tuning the GC](11-gc-tuning.md)                        | Practical flags, logs, containers, and common pitfalls |
