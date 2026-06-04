# Part IV — The Type System at Runtime

Scala has one of the richest type systems in mainstream programming. But what happens to all those types when your code reaches the JVM? Spoiler: most of them disappear. This part explores how the JVM sees types, how method dispatch works, and what the future holds with Project Valhalla.

| Chapter                                                               | Topic                                                |
| --------------------------------------------------------------------- | ---------------------------------------------------- |
| [12. How the JVM Sees Types](12-types-at-runtime.md)                  | Primitives, erasure, and the reality behind generics |
| [13. Inheritance and Method Dispatch](13-inheritance-and-dispatch.md) | Vtables, itables, and how trait methods work         |
| [14. Value Types and Project Valhalla](14-value-types-valhalla.md)    | The future: objects without overhead                 |

[← Back to main index](../index.md) · [← Part III](../part-3-memory-and-gc/index.md)
