# Chapter 20 — GraalVM and Native Image

[← Previous: JIT Deep Dive](19-jit-deep-dive.md) · [Next: Monitoring →](21-monitoring.md)

---

## What Is GraalVM?

GraalVM is an ecosystem with three main components:

1. **Graal JIT Compiler** — A JIT compiler written in Java (replacing HotSpot's C2)
2. **Truffle Framework** — A toolkit for implementing languages on the JVM
3. **Native Image** — An AOT compiler that creates standalone native executables

Let's explore each.

## The Graal JIT Compiler

HotSpot's C2 compiler is written in C++ and has accumulated decades of complexity. The Graal JIT is a modern replacement written in Java. Why does this matter?

- **Easier to maintain and extend** — Java is higher-level than C++
- **Better optimizations** in some cases — particularly **partial escape analysis**
- **Foundation for polyglot** — the same compiler infrastructure serves all Truffle languages

### Partial Escape Analysis

Standard escape analysis (Chapter 19) is all-or-nothing: either an object escapes or it doesn't. Graal's **partial escape analysis** handles the case where an object escapes on *some* paths but not others:

```java
Point p = new Point(x, y);
if (condition) {
    return p;              // Escapes on this path
} else {
    return p.x + p.y;     // Doesn't escape on this path
}
```

Standard escape analysis: Point always allocated (because it *might* escape).
Partial escape analysis: Point materialized only on the `return p` path. On the `else` path, it's replaced by scalars.

This is particularly beneficial for Scala's pattern of creating many small objects that are conditionally used.

### Using the Graal JIT

```bash
# Use Graal as the JIT compiler (within a standard JDK that supports JVMCI)
java -XX:+UseJVMCICompiler -jar myapp.jar
```

## Truffle: The Language Framework

Truffle lets you implement a programming language as an AST (Abstract Syntax Tree) interpreter, and Graal automatically JIT-compiles it to native code through **partial evaluation**:

```
Your Truffle interpreter:  AST → Walk nodes → Execute
Graal:                     Observes the interpreter running
                           Partially evaluates the interpreter + user program
                           Compiles to native code

Result: A user program in your language runs at near-native speed
```

Languages built on Truffle:
- **GraalJS** — JavaScript/Node.js
- **TruffleRuby** — Ruby
- **GraalPython** — Python
- **GraalWasm** — WebAssembly
- **Sulong** — LLVM bitcode (C/C++/Rust)

These languages can call each other with zero overhead through Truffle's polyglot API:

```java
// Java calling JavaScript calling Python
Context context = Context.create();
context.eval("js", "console.log('Hello from JS!')");
context.eval("python", "print('Hello from Python!')");
```

## Native Image: Ahead-of-Time Compilation

**Native Image** is GraalVM's AOT compiler. It takes your entire application (bytecode + all dependencies) and compiles it to a standalone native executable — no JVM needed at runtime.

### How It Works

```
Your Application (.jar)
     +
All Dependencies
     +
JDK Libraries
     │
     ▼
┌──────────────────────────────────┐
│      NATIVE IMAGE BUILD          │
│                                  │
│  1. Points-to analysis           │  ← Find ALL reachable code
│  2. Class initialization         │  ← Run static initializers at build time
│  3. Heap snapshot (image heap)   │  ← Serialize initialized data into binary
│  4. Ahead-of-time compilation    │  ← Compile to native machine code
│                                  │
└──────────────┬───────────────────┘
               │
               ▼
    myapp (native binary, ~30-100 MB)
    └── Runs directly on OS, no JVM
```

### Building a Native Image

```bash
# From a JAR
native-image -jar myapp.jar -o myapp

# From a main class
native-image -cp myapp.jar com.example.Main -o myapp

# Run it
./myapp   # Starts in milliseconds!
```

### Scala with Native Image

Using Scala CLI:
```bash
scala-cli package --native-image MyApp.scala -o myapp
```

Using sbt with `sbt-native-packager`:
```scala
// build.sbt
enablePlugins(NativeImagePlugin)
nativeImageOptions ++= Seq(
  "--no-fallback",
  "--initialize-at-build-time"
)
```

### Trade-offs

| Aspect               | JIT (HotSpot/Graal)        | AOT (Native Image)                |
| -------------------- | -------------------------- | --------------------------------- |
| **Startup**          | 1-5 seconds                | 10-50 milliseconds                |
| **Peak throughput**  | Excellent (profile-guided) | Good (no runtime profiling)       |
| **Memory footprint** | Higher (JIT, profiling)    | Lower (no JIT, no class metadata) |
| **Build time**       | Fast (seconds)             | Slow (minutes)                    |
| **Compatibility**    | Full                       | Limited (closed-world)            |
| **Distribution**     | Requires JDK               | Single binary                     |

### The Closed-World Assumption

Native Image must see **all reachable code at build time**. This means:

**Not supported without configuration:**
- **Reflection** — `Class.forName()`, `method.invoke()` need explicit config
- **Dynamic class loading** — No `new ClassLoader().loadClass()`
- **Runtime bytecode generation** — No ByteBuddy, CGLIB
- **JNI** — Needs configuration
- **Serialization** — Needs configuration

You provide configuration via JSON files:

```json
// reflect-config.json
[
  {
    "name": "com.example.MyClass",
    "allDeclaredMethods": true,
    "allDeclaredFields": true,
    "allDeclaredConstructors": true
  }
]
```

Or use the **tracing agent** to auto-discover:

```bash
# Run your app with the agent to record what's used
java -agentlib:native-image-agent=config-output-dir=./config -jar myapp.jar

# Use the recorded config for native-image
native-image -H:ConfigurationFileDirectories=./config -jar myapp.jar
```

### Build-Time Initialization

Native Image can run class initializers (static blocks, Scala `object` bodies) at **build time** instead of runtime. The initialized state is serialized into the binary:

```bash
native-image --initialize-at-build-time=com.example.Config -jar myapp.jar
```

This means `Config.loadDefaults()` runs during the build, and the result is baked into the binary. At runtime, it's instant.

> **Caution**: Build-time initialization can cause issues if the initializer reads environment variables, connects to databases, or uses random numbers — those values get frozen into the binary.

### Profile-Guided Optimization (PGO)

Native Image can use profiling data to optimize like a JIT — collect profiles at runtime, then rebuild:

```bash
# Step 1: Build an instrumented binary
native-image --pgo-instrument -jar myapp.jar -o myapp-inst

# Step 2: Run it under realistic load (generates profiles)
./myapp-inst
# ... exercise the application ...

# Step 3: Rebuild with profiles
native-image --pgo=default.iprof -jar myapp.jar -o myapp-optimized
```

This narrows the throughput gap between JIT and AOT.

## Scala Frameworks and Native Image

| Framework          | Native Image Support                             |
| ------------------ | ------------------------------------------------ |
| **http4s**         | Good (with Ember server)                         |
| **ZIO**            | Good (zio-http)                                  |
| **Scala CLI**      | Excellent (built-in support)                     |
| **Spark**          | Not supported (heavy reflection/dynamic loading) |
| **Play Framework** | Limited                                          |
| **Akka/Pekko**     | Partial (serialization issues)                   |

## When to Use Native Image

**Good fit:**
- CLI tools (instant startup matters)
- Serverless functions (AWS Lambda, Google Cloud Functions)
- Microservices that scale to zero
- Container-optimized deployments (small image size)

**Bad fit:**
- Long-running servers where peak throughput matters most
- Applications that rely heavily on reflection or dynamic loading
- Rapid development (slow build cycle)

## Key Takeaways

- **Graal JIT**: Modern JIT compiler in Java, with **partial escape analysis** for better optimization
- **Truffle**: Framework for building high-performance language runtimes on the JVM
- **Native Image**: AOT compilation to standalone binaries — millisecond startup, smaller footprint
- Native Image requires the **closed-world assumption** — all code visible at build time
- **Reflection** and dynamic features need explicit configuration
- Use the **tracing agent** to auto-discover reflection/JNI/resource usage
- **PGO** bridges the throughput gap between JIT and AOT
- Best for **CLI tools, serverless, and microservices**; less suitable for throughput-heavy long-running servers

---

[← Previous: JIT Deep Dive](19-jit-deep-dive.md) · [Next: Monitoring →](21-monitoring.md)
