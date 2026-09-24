# Part II — JVM Architecture

Now that you understand the big picture, let's open the hood and look at the JVM's internal architecture. How does it find and load your classes? What does bytecode look like up close? Where does everything live in memory? And how does bytecode become fast native code?

```text
┌─────────────────────────────┐
│         .class files        │
│           in JARs           │
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│         Class loader        │
│          subsystem          │
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│      Runtime data areas     │
│   heap, stacks, metaspace   │
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│       Execution engine      │
│      interpreter + JIT      │
└─────────────────────────────┘
```

| Chapter                                                           | Topic                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| [4. The Class Loader Subsystem](04-class-loaders.md)              | How classes are found, loaded, linked, and isolated       |
| [5. Bytecode — The JVM's Native Language](05-bytecode.md)         | The instruction set every JVM language targets            |
| [6. Runtime Data Areas (Memory Layout)](06-runtime-data-areas.md) | Heap, stacks, metaspace, code cache — where things live   |
| [7. The Execution Engine](07-execution-engine.md)                 | Interpreter, JIT compilers, AOT cache: how code gets fast |
