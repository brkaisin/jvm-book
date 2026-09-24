# Part IV — The Type System at Runtime

Scala has one of the richest type systems in mainstream programming. But what happens to all those types when your code reaches the JVM? Spoiler: most of them disappear. This part explores how the JVM sees types, how method dispatch works, and how Project Valhalla is finally teaching the JVM about objects that have no identity — starting with value objects, previewing in JDK 28.

| Chapter                                                                 | Topic                                                          |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| [12. How the JVM Sees Types](12-types-at-runtime.md)                    | Primitives, boxing, erasure, and runtime type tests            |
| [13. Inheritance and Method Dispatch](13-inheritance-and-dispatch.md)   | Vtables, itables, inline caches, invokedynamic, and traits     |
| [14. Value Objects and Project Valhalla](14-value-types-valhalla.md)    | Identity-free objects, flattening, and what comes next         |
