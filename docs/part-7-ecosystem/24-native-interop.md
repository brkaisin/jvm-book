# Chapter 24 — JNI, Panama, and Native Interop

## Why Call Native Code?

Sometimes you need to step outside the JVM:
- **System calls**: OS-specific features (memory-mapped files, sockets options, hardware sensors)
- **Performance-critical libraries**: OpenSSL, BLAS/LAPACK, compression and codec libraries
- **Existing C/C++ libraries**: code that already exists in native form (SQLite, RocksDB, TensorFlow…)
- **Hardware access**: GPU computation (CUDA), SIMD instructions

For 25 years the JVM offered one way to do this: **JNI**. It works, but it's painful. **Project Panama** delivered the modern replacement, the **Foreign Function & Memory (FFM) API**, final since Java 22.

```text
JNI
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌───────────┐
│ Java: native │──▶│ Generated C  │──▶│ Hand-written │──▶│ C library │
│ method       │   │ header       │   │ C glue       │   │           │
└──────────────┘   └──────────────┘   └──────────────┘   └───────────┘

FFM API
┌──────────────┐                                         ┌───────────┐
│ Java:        │────────────────────────────────────────▶│ C library │
│ MethodHandle │                                         │           │
└──────────────┘                                         └───────────┘
```

## JNI: The Old Way

The **Java Native Interface (JNI)** has been part of the platform since Java 1.1. Here's what it takes to call a simple C function.

### Step 1: Declare the Native Method (Java)

```java
public class NativeDemo {
    // Mark the method as native: no body, implemented in C
    public static native int add(int a, int b);

    static {
        System.loadLibrary("nativedemo");  // Loads libnativedemo.so / .dylib / nativedemo.dll
    }

    public static void main(String[] args) {
        System.out.println(add(3, 4));  // Calls the C function
    }
}
```

### Step 2: Generate the C Header

```bash
javac -h . NativeDemo.java
```

This generates `NativeDemo.h`:
```c
JNIEXPORT jint JNICALL Java_NativeDemo_add(JNIEnv *, jclass, jint, jint);
```

### Step 3: Implement in C

```c
#include "NativeDemo.h"

JNIEXPORT jint JNICALL Java_NativeDemo_add(JNIEnv *env, jclass cls, jint a, jint b) {
    return a + b;
}
```

### Step 4: Compile the Native Library

```bash
# Linux
gcc -shared -fPIC -o libnativedemo.so -I$JAVA_HOME/include -I$JAVA_HOME/include/linux NativeDemo.c

# macOS
gcc -shared -o libnativedemo.dylib -I$JAVA_HOME/include -I$JAVA_HOME/include/darwin NativeDemo.c
```

### Step 5: Run

```bash
java --enable-native-access=ALL-UNNAMED -Djava.library.path=. NativeDemo
# Output: 7
```

Without `--enable-native-access`, JDK 24 and later still run the program but print a warning first (see [below](#native-access-is-now-restricted)).

### Why JNI Is Painful

- **Boilerplate**: header generation, manual type mapping, error-prone parameter passing
- **Unsafe**: a wrong pointer crashes the whole JVM
- **Call overhead**: each transition goes through JNI wrappers, and the JIT can't see or optimize across the boundary
- **Platform-specific**: the C code must be compiled for each OS/architecture you ship to
- **GC interaction**: you must pin arrays (`GetPrimitiveArrayCritical`) or copy them so the GC doesn't move them while C code holds a pointer
- **Debugging**: when native code crashes, you get an `hs_err` file and a core dump, not a nice stack trace

## The FFM API: The Modern Way <span class="since">Java 22</span>

The **Foreign Function & Memory API** (package `java.lang.foreign`, JEP 454) lets you call native functions and manage native memory from pure Java. No C glue, no header generation.

### Calling a C Function

Let's call the standard C `strlen` function:

```java
import java.lang.foreign.*;
import java.lang.invoke.MethodHandle;

public class FfmDemo {
    public static void main(String[] args) throws Throwable {
        // 1. The linker knows the platform's C calling convention
        Linker linker = Linker.nativeLinker();
        SymbolLookup stdlib = linker.defaultLookup();   // the C standard library

        // 2. Describe the C signature: size_t strlen(const char *s)
        MethodHandle strlen = linker.downcallHandle(
            stdlib.find("strlen").orElseThrow(),
            FunctionDescriptor.of(ValueLayout.JAVA_LONG,   // return: size_t
                                  ValueLayout.ADDRESS)     // param:  const char*
        );

        // 3. Allocate a C string in an arena and call the function
        try (Arena arena = Arena.ofConfined()) {
            MemorySegment cString = arena.allocateFrom("Hello, Panama!");
            long length = (long) strlen.invokeExact(cString);
            System.out.println("Length: " + length);  // 14
        }  // native memory freed here
    }
}
```

`invokeExact` requires the call site types to match the descriptor exactly: a `MemorySegment` argument and a `long` result (hence the `(long)` cast). It is the fastest way to call a method handle, and the JIT can inline it.

> [!NOTE]
> `strlen` comes from the default lookup, which covers the C standard library. For your own library, use `SymbolLookup.libraryLookup("libfoo.so", arena)` (or `libraryLookup(Path, arena)`), or `SymbolLookup.loaderLookup()` after `System.loadLibrary`.

### Key Concepts

```text
┌────────────────────┐                            ┌────────────────────┐
│ SymbolLookup       │                            │ Arena              │
│                    │                            │ (lifetime)         │
└──────────┬─────────┘                            └──────────┬─────────┘
           │ find(name)              allocate / allocateFrom │
           ▼                                                 ▼
┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
│ MemorySegment      │   │ FunctionDescriptor │   │ MemorySegment      │
│ (function address) │   │ (C signature       │   │ (native memory)    │
│                    │   │ as layouts)        │   │                    │
└──────────┬─────────┘   └──────────┬─────────┘   └──────────┬─────────┘
           │                        │     passed as argument │
           ╰────────────────────╮   │   ╭────────────────────╯
                                ▼   ▼   ▼
                            ┌──────────────┐
                            │ MethodHandle │
                            └──────────────┘
                                    ▲
                                    │ downcallHandle(symbol, descriptor)
                       ┌────────────┴────────────┐
                       │  Linker.nativeLinker()  │
                       └─────────────────────────┘
```

#### Memory Segments

A `MemorySegment` is a bounded, lifetime-checked view of a block of memory, native or on-heap. Every access is checked against its size and its arena's lifetime, so an out-of-bounds read throws an exception instead of reading garbage:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(100);   // 100 bytes of native memory

    segment.set(ValueLayout.JAVA_INT, 0, 42);       // write an int at offset 0
    int value = segment.get(ValueLayout.JAVA_INT, 0); // 42

    segment.get(ValueLayout.JAVA_INT, 100);         // IndexOutOfBoundsException
}
```

Structured data (C structs) is described with layouts such as `MemoryLayout.structLayout(...)`, from which you can derive `VarHandle`s for each field.

#### Arenas

An **arena** controls the lifetime of native memory. When the arena closes, all its allocations are freed at once, and any later access fails safely:

| Arena                | Behavior                                                    |
| -------------------- | ----------------------------------------------------------- |
| `Arena.ofConfined()` | One owner thread, closed explicitly (try-with-resources)    |
| `Arena.ofShared()`   | Usable from many threads, closed explicitly                 |
| `Arena.ofAuto()`     | Freed by the GC when unreachable (like direct `ByteBuffer`s) |
| `Arena.global()`     | Never freed                                                 |

#### Function Descriptors

A `FunctionDescriptor` describes a C function's signature in terms of memory layouts:

```java
FunctionDescriptor.of(
    ValueLayout.JAVA_INT,       // return type
    ValueLayout.ADDRESS,        // first parameter (pointer)
    ValueLayout.JAVA_LONG       // second parameter (long)
);
FunctionDescriptor.ofVoid(ValueLayout.JAVA_INT);   // void f(int)
```

The API also supports **upcalls** (`linker.upcallStub(...)`): passing a Java method to C as a function pointer, for callbacks like `qsort`'s comparator.

### FFM vs JNI

| Aspect                | JNI                                          | FFM API                                         |
| --------------------- | -------------------------------------------- | ----------------------------------------------- |
| **Code to write**     | Java + generated header + C glue             | Pure Java (or generated by jextract)            |
| **Safety**            | A bad pointer crashes the JVM                | Bounds and lifetime checks on memory segments   |
| **Performance**       | JIT can't optimize across the boundary       | Downcalls are method handles the JIT can inline |
| **Memory management** | Manual (`GetPrimitiveArrayCritical`, `Release…`) | Arena-based, deterministic                  |
| **Build**             | C compiler per platform                      | No native compilation for the glue              |
| **Native access**     | Restricted since Java 24 (warning)           | Restricted too (same flag)                      |

> [!NOTE]
> FFM is *safer*, not *safe*: a wrong `FunctionDescriptor` or a C function that writes past a buffer can still crash the process. That's why the methods that bind native code are **restricted** methods.

### Native Access Is Now Restricted

<span class="since">Java 24</span> As part of [integrity by default](23-module-system.md#integrity-by-default), both JNI and FFM require the application to opt in (JEP 472). Loading a library with `System.loadLibrary`, binding a JNI `native` method, or calling a restricted FFM method such as `Linker.downcallHandle` or `SymbolLookup.libraryLookup` prints a one-time warning per module unless native access is enabled:

```bash
# Classpath code (most Scala apps)
java --enable-native-access=ALL-UNNAMED -jar myapp.jar

# Named modules
java --enable-native-access=com.example.db,com.example.crypto -m com.example.app
```

For an executable JAR, put `Enable-Native-Access: ALL-UNNAMED` in the manifest. `--illegal-native-access=allow|warn|deny` chooses what happens to code that isn't enabled; the default is `warn` (still the case in JDK 27) and a future release will switch to `deny`, which throws `IllegalCallerException`.

### From `sun.misc.Unsafe` to Supported APIs

For years, high-performance libraries (Netty, Kafka clients, Akka, lazy vals in Scala 3) used `sun.misc.Unsafe` to read and write memory without checks. Its memory-access methods are deprecated for removal (JEP 471, Java 23) and print a warning on first use since Java 24 (JEP 498; `--sun-misc-unsafe-memory-access=allow|warn|debug|deny`). There are two supported replacements, both as fast as `Unsafe` once JIT-compiled:

| `Unsafe` use                               | Replacement                                                  |
| ------------------------------------------ | ------------------------------------------------------------ |
| CAS / volatile access to a field or array  | `VarHandle` (`MethodHandles.lookup().findVarHandle(...)`)    |
| `allocateMemory` / `freeMemory`            | `Arena.allocate(...)` → `MemorySegment`                      |
| `getLong(address)` / `putLong(address, v)` | `MemorySegment.get/set(ValueLayout.JAVA_LONG, offset, v)`    |
| `copyMemory`                               | `MemorySegment.copy(...)`                                    |

```java
import java.lang.invoke.*;

class Counter {
    private volatile long count;
    private static final VarHandle COUNT;
    static {
        try {
            COUNT = MethodHandles.lookup().findVarHandle(Counter.class, "count", long.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    boolean compareAndSet(long expected, long next) {
        return COUNT.compareAndSet(this, expected, next);   // was: unsafe.compareAndSwapLong(...)
    }
}
```

### Using FFM from Scala

The API is plain Java, so it works from Scala as-is:

```scala
import java.lang.foreign.*
import java.lang.invoke.MethodHandle
import scala.util.Using

val linker = Linker.nativeLinker()
val stdlib = linker.defaultLookup()

val strlen: MethodHandle = linker.downcallHandle(
  stdlib.find("strlen").orElseThrow(),
  FunctionDescriptor.of(ValueLayout.JAVA_LONG, ValueLayout.ADDRESS)
)

Using.resource(Arena.ofConfined()) { arena =>
  val cString = arena.allocateFrom("Hello from Scala")
  val length = strlen.invoke(cString).asInstanceOf[Long]
  println(length)  // 16
}
```

> [!TIP]
> Here `invoke` (rather than `invokeExact`) is the forgiving choice: it adapts argument and return types, which saves you from having to match the exact Java static types from Scala. For hot paths, bind the handle once in a `val` (as here) and reuse it; creating the downcall handle is the expensive part.

### jextract: Generate the Bindings

Writing `FunctionDescriptor`s by hand gets tedious for big libraries. **jextract** (a separate tool from the OpenJDK project, not bundled with the JDK) reads C header files and generates Java source code on top of the FFM API:

```bash
jextract --include-dir /path/to/mylib/include \
         --output src/main/java \
         --target-package org.example.mylib \
         --library mylib \
         /path/to/mylib/include/mylib.h
```

You get Java classes with a static method per C function, plus accessors for structs:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment point = Point.allocate(arena);
    Point.x(point, 10);
    Point.y(point, 5);
    // pass `point` to a generated function wrapper…
}
```

The generated code is ordinary Java, so it can be compiled together with a Scala project.

## The Vector API: SIMD from Java <span class="preview">Incubator</span>

Panama's other half is the **Vector API** (`jdk.incubator.vector`), which expresses computations that the JIT compiles to SIMD instructions (SSE/AVX on x86, NEON/SVE on ARM), with a portable fallback:

```java
import jdk.incubator.vector.*;

static final VectorSpecies<Float> SPECIES = FloatVector.SPECIES_PREFERRED;

static void multiply(float[] a, float[] b, float[] c) {
    int i = 0;
    for (; i < SPECIES.loopBound(a.length); i += SPECIES.length()) {
        var va = FloatVector.fromArray(SPECIES, a, i);
        var vb = FloatVector.fromArray(SPECIES, b, i);
        va.mul(vb).intoArray(c, i);
    }
    for (; i < a.length; i++) {       // scalar tail
        c[i] = a[i] * b[i];
    }
}
```

It is in its **12th incubator round in JDK 27** (JEP 537). The API itself is mature, but it will stay incubating until Project Valhalla's value classes land, so that vectors can become proper value objects. Using it requires `--add-modules jdk.incubator.vector`.

## Scala Native: The Alternative Path

For Scala specifically, there's another option: **Scala Native**. It compiles Scala directly to native code via LLVM, with no JVM at all:

```scala
// Scala Native: direct C interop
import scala.scalanative.unsafe.*

@extern
object mylib:
  def add(a: CInt, b: CInt): CInt = extern

@main def run(): Unit =
  val result = mylib.add(3, 4)
  println(result)
```

Scala Native has different trade-offs:
- **No JVM at all**: instant startup, small binary
- **No JIT**: throughput depends on ahead-of-time LLVM optimization
- **Direct C interop**: first-class, no bridges, no native-access flags
- **Smaller ecosystem**: only Scala libraries published for Scala Native work; Java libraries don't

For JVM Scala projects that need C interop, the FFM API is the way forward. Scala Native is for when you don't want the JVM at all.

<div class="takeaways">

## Key Takeaways

- **JNI** works but is painful: C glue code, crashes, and a boundary the JIT can't optimize across
- The **FFM API** (final in Java 22) calls C from pure Java: `Linker` + `SymbolLookup` + `FunctionDescriptor` → a `MethodHandle`
- **Memory segments** are bounds- and lifetime-checked views of memory; **arenas** free native memory deterministically
- Since Java 24, native access (JNI *and* FFM) warns unless you pass `--enable-native-access=ALL-UNNAMED` (or a module list); it will become an error
- `sun.misc.Unsafe` memory access is on its way out: use `VarHandle` and `MemorySegment`
- **jextract** generates FFM bindings from C headers
- The **Vector API** is still incubating (12th round in JDK 27), waiting for Valhalla
- **Scala Native** compiles Scala to native code without a JVM

</div>
