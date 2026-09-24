# The JVM — A Gentle Deep Dive

A gentle but thorough book about the Java Virtual Machine, written for Scala and Java developers: from its origins and architecture to memory, garbage collection, concurrency, and the modern projects reshaping it (Loom, Panama, Leyden, Lilliput, Valhalla).

Up to date with **JDK 27** (September 2026), the current LTS **JDK 25**, and what's coming in JDK 28.

📖 **Read online:** [https://brkaisin.github.io/jvm-book](https://brkaisin.github.io/jvm-book)

## Contents

1. **The Big Picture** — Why the JVM exists, the journey from source to execution, and a timeline from Java 1.0 to Java 27
2. **JVM Architecture** — Class loaders, bytecode, runtime data areas, and the execution engine
3. **Memory & Garbage Collection** — Object layout, GC fundamentals, a tour of the collectors, and GC tuning
4. **The Type System at Runtime** — How the JVM sees types, inheritance and method dispatch, value objects and Project Valhalla
5. **Concurrency and Threading** — Threads, the Java Memory Model, `java.util.concurrent`, and virtual threads (Project Loom)
6. **Performance, Monitoring & Tooling** — JIT deep dive, ahead-of-time compilation (Project Leyden and GraalVM Native Image), monitoring, and common pitfalls
7. **The JVM Ecosystem & Beyond** — The module system, JNI and Panama, the JVM language ecosystem, and what's next
8. **Appendices** — JVM flags cheat sheet, bytecode reference, and glossary

## Explore the JVM in 3D

The book comes with an interactive 3D explorer: a small, living JVM you can fly through, where every part links back to the chapter that explains it. Try it at [brkaisin.github.io/jvm-book/explorer](https://brkaisin.github.io/jvm-book/explorer/).

It lives in [`explorer/`](explorer/), a TypeScript + [Three.js](https://threejs.org/) app built with [Vite](https://vite.dev/):

- `src/sim/`: a pure, deterministic model of the JVM (G1/ZGC heap, tiered JIT, platform and virtual threads, class loading), unit-tested with Vitest
- `src/view/`: the Three.js scene, which only renders the simulation's state
- `src/ui/`: the panels, tour, map and flight-recorder HUD
- `src/content.ts`: every explanation and every link into the book (a test checks that each link points to a real chapter and heading)

## Building locally

Requires [mdBook](https://rust-lang.github.io/mdBook/) and Node.js 22+:

```bash
brew install mdbook   # or cargo install mdbook

cd explorer
npm install
npm run check         # typecheck + tests
npm run build         # builds the explorer into docs/explorer/
npm run dev           # or: hot-reloading dev server for the explorer alone
cd ..

mdbook serve          # live preview at http://localhost:3000
mdbook build          # static output in ./book/
```

## License

This work is provided for educational purposes.
