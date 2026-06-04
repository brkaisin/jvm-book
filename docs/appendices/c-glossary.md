# Appendix C — Glossary

[← Previous: Bytecode Reference](b-bytecode-reference.md) · [← Back to main index](../README.md)

---

JVM terminology, explained in plain language.

---

**AOT (Ahead-of-Time) Compilation**
Compiling code to native machine code *before* running it, rather than at runtime. GraalVM Native Image does this. Contrast with JIT.

**Autoboxing**
The automatic conversion between a primitive (`int`) and its wrapper object (`Integer`). Happens silently and can cause significant allocation overhead in loops.

**Biased Locking**
An optimization where a lock is "biased" toward the first thread that acquires it, making subsequent acquisitions by the same thread very cheap. Deprecated in Java 15 and removed in Java 18.

**Bootstrap Class Loader**
The root class loader, implemented in native code. Loads core JDK classes from `java.base`. Has no parent.

**Bytecode**
The instruction set of the JVM. Platform-independent binary format stored in `.class` files. Not machine code — the JVM interprets or JIT-compiles it to native code.

**C1 Compiler (Client Compiler)**
The fast, lightly-optimizing JIT compiler. Produces code quickly but with fewer optimizations. Used in tiered compilation as the first JIT tier.

**C2 Compiler (Server Compiler)**
The heavily-optimizing JIT compiler. Takes longer to compile but produces faster code. Used for hot methods in tiered compilation.

**Card Table**
A data structure that tracks which regions of old-generation memory contain pointers to young-generation objects. Enables efficient young-generation GC without scanning the entire heap.

**CDS (Class Data Sharing)**
A mechanism to pre-process class metadata into a shared archive file, reducing startup time and memory footprint when multiple JVM instances share the archive.

**Class Loader**
A component that loads `.class` files (bytecode) into the JVM at runtime. Follows a parent-delegation model: ask parent first, load yourself only if the parent can't.

**Closed-World Assumption**
The requirement (in GraalVM Native Image) that all code reachable at runtime must be known at build time. No dynamic class loading, no runtime bytecode generation.

**Compressed OOPs (Ordinary Object Pointers)**
A technique to use 32-bit references instead of 64-bit on 64-bit JVMs, effective for heaps up to ~32 GB. Saves memory by shifting the pointer (since objects are 8-byte aligned).

**Concurrent GC**
A garbage collector that does most of its work while application threads are running. G1, ZGC, and Shenandoah are concurrent collectors.

**Constant Pool**
A table in each `.class` file containing all constants (strings, numbers, class names, method references) used by the class.

**Deoptimization**
When the JIT's speculative optimizations are invalidated (e.g., a new class is loaded that changes the assumption), compiled code is discarded and execution falls back to the interpreter.

**Eden Space**
The area of the young generation where new objects are allocated. Most objects die here and never leave.

**Escape Analysis**
A JIT optimization that determines whether an object "escapes" the method or thread where it was created. Non-escaping objects can be stack-allocated or scalar-replaced.

**Foreign Function & Memory API (Panama)**
Java 22+ API for calling native (C/C++) code and managing native memory safely, without JNI.

**Frame (Stack Frame)**
The data structure for a single method invocation on a thread's stack. Contains local variables, operand stack, and a reference to the constant pool.

**GC Roots**
The starting points for garbage collection reachability analysis. Includes local variables, static fields, JNI references, and active thread references.

**Generational GC**
A GC strategy based on the observation that most objects die young. Divides the heap into young and old generations, collecting young objects more frequently.

**Heap**
The runtime memory area where all Java objects are allocated. Shared by all threads. Managed by the garbage collector.

**HotSpot**
The most widely used JVM implementation, developed by Oracle. Named after its technique of identifying and optimizing "hot spots" (frequently executed code).

**Image Heap**
In GraalVM Native Image, the pre-initialized heap snapshot baked into the native binary at build time.

**Intrinsic**
A method that the JIT compiler recognizes and replaces with a hand-optimized native implementation instead of compiling from bytecode. Examples: `Math.min()`, `System.arraycopy()`.

**invokedynamic**
A bytecode instruction (added in Java 7) that defers method linkage to a *bootstrap method* at runtime. Used for lambdas, string concatenation, and dynamic language support.

**JFR (Java Flight Recorder)**
A built-in profiling framework that records JVM events (GC, threads, I/O, compilation) with very low overhead (< 2%). Safe for production use.

**JIT (Just-in-Time) Compilation**
Compiling bytecode to native machine code at runtime, based on profiling data. The JIT can optimize for the actual workload, which is sometimes better than static compilation.

**JMX (Java Management Extensions)**
A framework for managing and monitoring JVM applications through MBeans (Managed Beans). Used by monitoring tools like VisualVM and Prometheus JMX Exporter.

**JNI (Java Native Interface)**
The original (and now legacy) mechanism for calling native C/C++ code from the JVM and vice versa. Being replaced by Project Panama.

**JPMS (Java Platform Module System)**
The module system introduced in Java 9 (Project Jigsaw). Defines explicit dependencies and encapsulation for groups of packages.

**JVMCI (JVM Compiler Interface)**
An interface that allows an external JIT compiler (like Graal) to plug into HotSpot, replacing the C2 compiler.

**JVMTI (JVM Tool Interface)**
A native programming interface for building development and monitoring tools. Used by debuggers and profilers.

**Mark Word**
The first field of every object's header. Contains identity hash code, GC age, lock state, and biased locking information.

**Metaspace**
The native memory area (since Java 8) where class metadata, method bytecode, and constant pools are stored. Replaced PermGen.

**Method Area**
The logical area of memory where class-level data is stored. Physically implemented as Metaspace.

**Monomorphic Call Site**
A call site where only one type has been observed. The JIT can inline the method directly. The best case for performance.

**Megamorphic Call Site**
A call site where 3 or more types have been observed. The JIT gives up inlining and falls back to virtual dispatch (vtable/itable). The worst case for inlining.

**Native Image**
GraalVM's tool for compiling Java/Scala/Kotlin applications to standalone native executables via ahead-of-time compilation.

**Native Method Stack**
A per-thread stack for native method (JNI) execution.

**Object Header**
The metadata at the beginning of every Java object: mark word + class pointer. Typically 12 bytes (with compressed OOPs) or 16 bytes (without).

**Operand Stack**
A per-frame LIFO stack used by bytecode instructions to pass values. The JVM is a stack-based virtual machine.

**OSR (On-Stack Replacement)**
Replacing a method's interpreted code with JIT-compiled code while the method is still running. Used for long-running methods (like loops) that become hot mid-execution.

**Parent Delegation**
The class loading strategy where a class loader asks its parent to load a class before trying itself. Ensures core classes (`java.lang.String`) are always loaded by the bootstrap loader.

**PC Register (Program Counter)**
A per-thread register that points to the currently executing bytecode instruction.

**PGO (Profile-Guided Optimization)**
Using runtime profiling data to guide ahead-of-time compilation decisions. GraalVM Native Image supports this.

**Safepoint**
A point in the code where the JVM can safely pause a thread (for GC, deoptimization, etc.). The thread's state is consistent and all references are known.

**Scalar Replacement**
A JIT optimization that replaces an object with its individual fields, eliminating the allocation entirely. Enabled by escape analysis.

**STW (Stop-the-World)**
A GC pause during which all application threads are stopped. All GCs have some STW phases, but modern collectors (ZGC, Shenandoah) keep them under 1 ms.

**Structured Concurrency**
A programming model (Project Loom) where concurrent tasks have well-defined lifetimes tied to their parent task. When the parent completes or fails, child tasks are automatically managed.

**Survivor Space**
Two equally-sized areas (S0, S1) in the young generation. Objects that survive a young GC are copied between survivors. After enough surviving, objects are promoted to old generation.

**Thread-Local Allocation Buffer (TLAB)**
A per-thread region of Eden space for fast, lock-free object allocation. Each thread allocates from its own TLAB without synchronization.

**Tiered Compilation**
The default JIT strategy since Java 8: methods are first compiled by C1 (fast, light optimizations), then recompiled by C2 (slower, heavy optimizations) when they're hot enough.

**Type Erasure**
The JVM's handling of generics: type parameters are erased at runtime. `List<String>` and `List<Int>` are both just `List` at the bytecode level. This is why you can't do `x.isInstanceOf[List[String]]` reliably.

**Uncommon Trap**
A fallback path in JIT-compiled code for cases the compiler assumed wouldn't happen. When triggered, execution deoptimizes back to the interpreter.

**Value Type (Valhalla)**
A future JVM feature: user-defined types without identity (no `synchronized`, no `identityHashCode`). Stored inline like primitives, with no object header overhead.

**Virtual Thread (Loom)**
A lightweight thread managed by the JVM rather than the OS. Millions can exist simultaneously. Multiplexed onto a small pool of OS (carrier) threads.

**vtable (Virtual Method Table)**
A per-class lookup table mapping method signatures to their implementation addresses. Used for `invokevirtual` dispatch. Each class inherits and extends its parent's vtable.

**itable (Interface Method Table)**
A per-class set of lookup tables for interface method dispatch. Used by `invokeinterface`. Slower than vtable dispatch because the interface must be found first.

---

[← Previous: Bytecode Reference](b-bytecode-reference.md) · [← Back to main index](../README.md)
