# Appendix C — Glossary

JVM terminology, explained in plain language. Terms in *italics* inside a definition have their own entry.

**Amber (Project)**
The OpenJDK project for smaller, productivity-oriented Java language features: `var`, records, sealed types, pattern matching, text blocks, unnamed variables, compact source files, module imports.

**AOT (Ahead-of-Time) Compilation**
Compiling code to native machine code *before* running it, rather than at runtime. GraalVM *Native Image* compiles a whole application this way; Project *Leyden* is adding AOT-compiled code to the *AOT cache* (proposed for JDK 28). Contrast with *JIT*.

**AOT Cache**
A file (usually `app.aot`) produced by a *training run* that stores work the JVM would otherwise redo at every startup: classes already loaded and linked (JDK 24), method profiles (JDK 25), and, as proposed for JDK 28, compiled code. Used with `-XX:AOTCacheOutput=` (create) and `-XX:AOTCache=` (use). It generalizes *CDS*.

**Arena**
In the *FFM API*, an object that controls the lifetime of native memory. Everything allocated in an arena is freed when it closes (`Arena.ofConfined()`, `Arena.ofShared()`), when the GC finds it unreachable (`Arena.ofAuto()`), or never (`Arena.global()`).

**Autoboxing**
The automatic conversion between a primitive (`int`) and its wrapper object (`Integer`). Happens silently and can cause significant allocation overhead in loops.

**Babylon (Project)**
The OpenJDK project for *code reflection*: giving libraries access to a method's or lambda's code as a data structure, to translate it to GPUs, SQL, or ML formats. A first incubator JEP has been submitted but isn't in a release yet.

**Biased Locking**
A former optimization where a lock was "biased" toward the first thread that acquired it, making re-acquisition by that thread very cheap. Deprecated in Java 15 and removed in Java 18.

**Bootstrap Class Loader**
The root class loader, implemented inside the JVM. Loads core JDK classes such as those in `java.base`. Has no parent.

**Bytecode**
The instruction set of the JVM. A platform-independent binary format stored in `.class` files. Not machine code: the JVM interprets or JIT-compiles it to native code.

**C1 Compiler (Client Compiler)**
The fast, lightly optimizing JIT compiler. Produces code quickly but with fewer optimizations. The first JIT tier in *tiered compilation*.

**C2 Compiler (Server Compiler)**
The heavily optimizing JIT compiler. Takes longer to compile but produces faster code. Used for hot methods in tiered compilation.

**Card Table**
A data structure that tracks which regions of old-generation memory contain pointers to young-generation objects. Enables efficient young-generation GC without scanning the entire heap.

**Carrier Thread**
A platform (OS) thread on which *virtual threads* are mounted to run. By default the JVM uses about one carrier per CPU core.

**CDS (Class Data Sharing)**
A mechanism that stores pre-parsed class metadata in an archive file, reducing startup time and memory footprint (the archive can be shared between JVM processes). The JDK ships a default CDS archive for its own classes; AppCDS extends it to application classes. The *AOT cache* builds on it.

**Class File Version**
The major/minor version number in every `.class` file. Major = Java version + 44 (Java 21 = 65, Java 25 = 69, Java 27 = 71). A JVM rejects classes newer than itself with `UnsupportedClassVersionError`.

**Class-File API**
The standard API for reading, transforming and writing class files (`java.lang.classfile`), final in Java 24. The JDK's own replacement for libraries like ASM.

**Class Loader**
A component that loads `.class` files into the JVM at runtime. Follows a parent-delegation model: ask the parent first, load it yourself only if the parent can't.

**Closed-World Assumption**
The requirement (in GraalVM *Native Image*) that all code reachable at runtime is known at build time. No arbitrary dynamic class loading, and reflection must be declared up front.

**Compact Object Headers**
The *Lilliput* object header layout that fits the mark word and a compressed class index into a single 64-bit word, shrinking headers from 12 to 8 bytes. Experimental in JDK 24, a product option in 25, **on by default in JDK 27**. Disable with `-XX:-UseCompactObjectHeaders`.

**Compact Source File**
A Java source file without an explicit class declaration, with an instance `main` method (`void main() { IO.println("Hi"); }`). It automatically imports `java.base`. Final in Java 25.

**Compressed OOPs (Ordinary Object Pointers)**
Using 32-bit references instead of 64-bit ones on 64-bit JVMs, for heaps up to about 32 GB. Works by storing the address shifted right by 3, since objects are 8-byte aligned.

**Concurrent GC**
A garbage collector that does most of its work while application threads keep running. G1 (for marking), ZGC, and Shenandoah are concurrent collectors.

**Constant Pool**
A table in each `.class` file containing the constants used by the class: strings, numbers, class names, method and field references, method handles, and bootstrap information.

**Deoptimization**
When the JIT's speculative optimizations are invalidated (for example, a newly loaded class breaks an assumption), the compiled code is discarded and execution falls back to the interpreter.

**Downcall / Upcall**
In the *FFM API*: a downcall is a call from Java into a native function (via a `MethodHandle` from `Linker.downcallHandle`); an upcall is native code calling back into Java (via a function pointer from `Linker.upcallStub`).

**Eden Space**
The area of the young generation where new objects are allocated. Most objects die here and never leave.

**Escape Analysis**
A JIT optimization that determines whether an object "escapes" the method or thread that created it. Non-escaping objects can be *scalar-replaced* (their allocation removed).

**FFM API (Foreign Function & Memory API)**
The `java.lang.foreign` API (Project *Panama*) for calling native C code and working with native memory safely, without *JNI*. Final in Java 22. Key types: `Linker`, `SymbolLookup`, `FunctionDescriptor`, `MemorySegment`, *Arena*.

**Frame (Stack Frame)**
The data structure for a single method invocation on a thread's stack. Contains local variables, the operand stack, and a reference to the class's constant pool.

**GC Roots**
The starting points for garbage collection reachability analysis: local variables in live frames, static fields, JNI references, and similar.

**Generational GC**
A GC strategy based on the observation that most objects die young. It divides the heap into young and old generations and collects the young one more often. G1, Parallel, Serial, ZGC (since 21, only mode since 24) and Shenandoah (optional, product since 25) are generational.

**Heap**
The runtime memory area where Java objects are allocated. Shared by all threads. Managed by the garbage collector.

**HotSpot**
The most widely used JVM implementation, originally from Sun and now developed in the OpenJDK project. Named after its technique of finding and optimizing "hot spots" (frequently executed code).

**Identity**
The property that makes two objects with equal fields still distinguishable (`==` compares references). Identity enables `synchronized` and `System.identityHashCode`, but it forces the JVM to keep each object as a separate heap allocation. *Value objects* give it up.

**Image Heap**
In GraalVM *Native Image*, the pre-initialized heap snapshot baked into the native binary at build time.

**Incubator Module**
A way to ship an API that is not final yet, in a `jdk.incubator.*` module that must be added explicitly (`--add-modules`). The *Vector API* has been incubating since JDK 16.

**Integrity by Default**
The JDK's policy that code can rely on the guarantees the language gives (`private` stays private, `final` stays final) unless the application owner explicitly opts out on the command line. It covers strong encapsulation (17), the removal of the Security Manager (24), restrictions on native access (24), `sun.misc.Unsafe` memory access (24), and reflective final-field mutation (26).

**Intrinsic**
A method that the JIT compiler recognizes and replaces with a hand-optimized implementation instead of compiling its bytecode. Examples: `Math.min()`, `System.arraycopy()`, `String.equals()`.

**invokedynamic**
A bytecode instruction (Java 7) that defers method linkage to a *bootstrap method* at runtime. Used for lambdas, string concatenation, records' `toString`/`equals`/`hashCode`, pattern `switch`, and dynamic languages.

**itable (Interface Method Table)**
A per-class set of lookup tables for interface method dispatch. Used by `invokeinterface`. Slower than vtable dispatch because the right interface table must be found first.

**JEP (JDK Enhancement Proposal)**
The document that describes a significant change to the JDK, with a number (e.g., JEP 444 Virtual Threads). A JEP moves through states such as Draft, Candidate, Proposed to Target, Targeted, Integrated and Closed/Delivered. The list lives at openjdk.org/jeps.

**JFR (JDK Flight Recorder)**
A built-in event recorder that captures JVM and application events (GC, threads, I/O, compilation, CPU samples) with low overhead (typically around 1%). Safe for production use.

**JIT (Just-in-Time) Compilation**
Compiling bytecode to native machine code at runtime, guided by profiling data. The JIT can optimize for the actual workload, which is sometimes better than static compilation.

**jlink**
The JDK tool that assembles a custom runtime image containing only the modules an application needs.

**JMX (Java Management Extensions)**
A framework for managing and monitoring JVM applications through MBeans (Managed Beans). Used by tools like VisualVM, JConsole and the Prometheus JMX Exporter.

**JNI (Java Native Interface)**
The original mechanism for calling native C/C++ code from the JVM and vice versa. Still supported, but the *FFM API* is the modern replacement. Loading native libraries prints a warning since JDK 24 unless `--enable-native-access` is given.

**Joiner**
In *structured concurrency*, the policy object passed to `StructuredTaskScope.open(joiner)` that decides when the scope is done and what `join()` returns, e.g. `Joiner.allSuccessfulOrThrow()` or `Joiner.anySuccessfulOrThrow()`. Replaced the older `ShutdownOnFailure`/`ShutdownOnSuccess` subclasses in Java 25.

**JPMS (Java Platform Module System)**
The module system introduced in Java 9 (Project Jigsaw). Groups packages into modules with explicit dependencies (`requires`) and encapsulation (`exports`, `opens`).

**JVMCI (JVM Compiler Interface)**
An interface that allows a JIT compiler written in Java (like Graal) to plug into HotSpot in place of C2.

**JVMTI (JVM Tool Interface)**
A native programming interface for building development and monitoring tools. Used by debuggers, profilers and agents.

**Lazy Constant**
A preview API (`java.lang.LazyConstant`, formerly "stable values") for a value computed at most once, on first access, that the JIT can then treat as a true constant: `LazyConstant.of(() -> createLogger())`, then `get()`. Third preview in JDK 27. Similar in spirit to a Scala `lazy val`.

**Leyden (Project)**
The OpenJDK project for improving startup time, warmup time and footprint by shifting work to a *training run* and storing the result in the *AOT cache*. Shipping since JDK 24.

**Lilliput (Project)**
The OpenJDK project to shrink object headers. Delivered *compact object headers* (8 bytes, default in JDK 27); 4-byte headers are being explored next.

**Loom (Project)**
The OpenJDK project that delivered *virtual threads* (Java 21), *scoped values* (Java 25) and *structured concurrency* (still in preview).

**LTS (Long-Term Support)**
A JDK release that vendors support for many years. Since Java 17, an LTS comes every two years: 17 (2021), 21 (2023), 25 (2025), then 29 (2027). The releases in between are supported for six months, until the next one.

**Mark Word**
The first 64 bits of every object's header. Holds the identity hash code, GC age and lock state; with *compact object headers* it also holds the class index.

**Megamorphic Call Site**
A call site where more than two receiver types have been observed. The JIT stops inlining there and falls back to virtual dispatch (vtable/itable). The worst case for inlining.

**MemorySegment**
In the *FFM API*, a bounded view of a region of memory (native or on-heap). Every access is checked against its size and its *arena*'s lifetime. The supported replacement for `sun.misc.Unsafe` off-heap memory access.

**Metaspace**
The native memory area (since Java 8) where class metadata is stored. Replaced PermGen.

**Method Area**
The JVM specification's logical area for class-level data. In HotSpot it is implemented by Metaspace.

**Monomorphic Call Site**
A call site where only one receiver type has been observed. The JIT can inline the method directly. The best case for performance.

**Native Image**
GraalVM's tool for compiling Java/Scala/Kotlin applications to standalone native executables via ahead-of-time compilation, under the *closed-world assumption*.

**Native Method Stack**
A per-thread stack used when executing native (C) code.

**Object Header**
The metadata at the beginning of every Java object: *mark word* + class pointer, plus the length for arrays. On 64-bit JVMs it is 12 bytes with compressed class pointers, or 8 bytes with *compact object headers* (the default since JDK 27).

**Operand Stack**
A per-frame LIFO stack used by bytecode instructions to pass values. The JVM is a stack-based virtual machine.

**OSR (On-Stack Replacement)**
Replacing a method's interpreted code with JIT-compiled code while the method is still running. Used for long-running loops that become hot mid-execution.

**Panama (Project)**
The OpenJDK project for connecting Java with native code and hardware: the *FFM API* (final in 22), jextract, and the *Vector API*.

**Parent Delegation**
The class loading strategy where a class loader asks its parent to load a class before trying itself. Ensures core classes (`java.lang.String`) are always loaded by the bootstrap loader.

**PC Register (Program Counter)**
A per-thread register that points to the currently executing bytecode instruction.

**PGO (Profile-Guided Optimization)**
Using profiling data from real runs to guide compilation. GraalVM Native Image supports it; the *AOT cache* brings a form of it to HotSpot by storing method profiles from a training run.

**Pinning**
When a *virtual thread* cannot unmount from its *carrier thread* while blocked, so the carrier is blocked too. Since JDK 24 `synchronized` no longer pins; native frames and class initialization still can.

**Preview Feature**
A complete but not yet permanent language, VM or API feature, shipped to gather feedback. Must be enabled with `--enable-preview` at compile time and run time, and may change or be removed in the next release.

**Restricted Method**
An *FFM API* or JNI-related method that can break integrity (e.g., `Linker.downcallHandle`, `System.loadLibrary`). Calling one prints a warning unless native access is enabled for the caller's module.

**Safepoint**
A point in the code where the JVM can safely pause a thread (for GC, deoptimization, etc.). The thread's state is consistent and all references are known.

**Scalar Replacement**
A JIT optimization that replaces an object with its individual fields held in registers or on the stack, eliminating the allocation entirely. Enabled by *escape analysis*.

**Scoped Value**
An immutable value bound for the duration of a method call and visible to everything that call runs, including child threads in a structured scope (`ScopedValue.where(KEY, value).run(...)`). A cheaper, safer alternative to `ThreadLocal`, final in Java 25.

**STW (Stop-the-World)**
A pause during which all application threads are stopped. All GCs have some STW phases, but ZGC and Shenandoah keep them to around a millisecond or less.

**Structured Concurrency**
A programming model (Project *Loom*) where concurrent subtasks live inside a scope tied to the parent: the parent waits for them, failures and cancellation propagate, and none can leak. In Java: `StructuredTaskScope.open()` + `fork` + `join`, customized with a *Joiner*. Still a preview API (7th preview in JDK 27).

**Survivor Space**
Two equally sized areas (S0, S1) in the young generation of the classic generational layouts. Objects that survive a young GC are copied between them and eventually promoted to the old generation.

**Thread-Local Allocation Buffer (TLAB)**
A per-thread region of Eden for fast, lock-free object allocation: allocating is just bumping a pointer.

**Tiered Compilation**
The default JIT strategy (since Java 8): methods are interpreted, then compiled by C1, then recompiled by C2 once they're hot enough.

**Training Run**
A run of an application used to record its behaviour (which classes it loads, which methods get hot) so the JVM can build an *AOT cache* for later runs. Typically done in CI or when building a container image.

**Type Erasure**
The JVM's handling of generics: type parameters are erased at runtime. `List<String>` and `List<Integer>` are both just `List` at the bytecode level. This is why `x.isInstanceOf[List[String]]` can't check the element type.

**Uncommon Trap**
A fallback path in JIT-compiled code for cases the compiler assumed wouldn't happen. When triggered, execution deoptimizes back to the interpreter.

**Unnamed Module**
The module that all code on the classpath belongs to. It can read every named module but can't be required by them; command-line flags refer to it as `ALL-UNNAMED`.

**Valhalla (Project)**
The OpenJDK project bringing *value objects* (preview in JDK 28), then null-restricted types and, later, generics over primitives and value types.

**Value Object**
An object of a `value class` or `value record` (Valhalla, JEP 401, preview in JDK 28): it has no *identity*, so `==` compares its class and field values, and `synchronized` on it throws `IdentityException`. This lets the JVM flatten it into fields and arrays or keep it in registers. With preview enabled, `Integer`, `Optional` and `LocalDate` become value classes too.

**VarHandle**
A typed reference to a field, array element or memory location (`java.lang.invoke.VarHandle`, Java 9) supporting plain, volatile, and atomic access such as `compareAndSet`. The supported replacement for `sun.misc.Unsafe` on-heap operations; Scala 3.8+ lazy vals use it.

**Vector API**
An API (`jdk.incubator.vector`) for expressing SIMD computations that the JIT compiles to vector instructions such as AVX or NEON. Still incubating (12th round in JDK 27), waiting for Valhalla.

**Virtual Thread (Loom)**
A lightweight thread managed by the JVM rather than the OS. Millions can exist at once, multiplexed onto a small pool of *carrier threads*. Final in Java 21.

**vtable (Virtual Method Table)**
A per-class lookup table mapping virtual methods to their implementations. Used for `invokevirtual` dispatch. Each class inherits and extends its parent's vtable.
