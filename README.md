# The JVM — A Gentle Deep Dive

A comprehensive book exploring the Java Virtual Machine, from its origins and architecture to modern innovations like GraalVM, Project Loom, and Project Valhalla.

📖 **Read online:** [https://brkaisin.github.io/jvm-book](https://brkaisin.github.io/jvm-book)

## Contents

1. **The Big Picture** — Why the JVM exists, its architecture, and historical timeline
2. **Class Files & Bytecode** — Class file anatomy, bytecode instructions, and the constant pool
3. **Runtime & Execution** — Class loading, the execution engine, JIT compilation, and memory model
4. **Type System** — Generics, type erasure, invokedynamic, and Project Valhalla
5. **Concurrency** — The Java Memory Model, synchronized, locks, and virtual threads (Project Loom)
6. **Garbage Collection** — GC fundamentals, collectors from Serial to ZGC, and tuning strategies
7. **Beyond Java** — GraalVM, polyglot capabilities, native image, and the JVM's future

## Building locally

Requires [mdBook](https://rust-lang.github.io/mdBook/):

```bash
brew install mdbook   # or cargo install mdbook
mdbook serve          # live preview at http://localhost:3000
mdbook build          # static output in ./book/
```

## License

This work is provided for educational purposes.
