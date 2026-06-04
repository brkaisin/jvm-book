# Chapter 24 — JNI, Panama, and Native Interop

[← Previous: Module System](23-module-system.md) · [Next: Language Ecosystem →](25-language-ecosystem.md)

---

## Why Call Native Code?

Sometimes you need to step outside the JVM:
- **System calls**: Accessing OS-specific features (memory-mapped files, hardware sensors)
- **Performance-critical libraries**: OpenSSL, BLAS/LAPACK, codec libraries
- **Existing C/C++ libraries**: Using code that already exists in native form
- **Hardware access**: GPU computation (CUDA), SIMD instructions

The JVM has historically provided one way to do this: **JNI**. It works, but it's painful. **Project Panama** is the modern replacement.

## JNI: The Old Way

**Java Native Interface (JNI)** has been part of the JVM since Java 1.1. Here's what it takes to call a simple C function:

### Step 1: Declare the Native Method (Java)

```java
public class NativeDemo {
    // Mark the method as native — no body, implemented in C
    public static native int add(int a, int b);

    static {
        System.loadLibrary("nativedemo");  // Load libnativedemo.so / nativedemo.dll
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
gcc -shared -o libnativedemo.so -I$JAVA_HOME/include -I$JAVA_HOME/include/linux NativeDemo.c

# macOS
gcc -shared -o libnativedemo.dylib -I$JAVA_HOME/include -I$JAVA_HOME/include/darwin NativeDemo.c
```

### Step 5: Run

```bash
java -Djava.library.path=. NativeDemo
# Output: 7
```

### Why JNI Is Painful

- **Boilerplate**: Header generation, manual type mapping, error-prone parameter passing
- **Unsafe**: Easy to crash the JVM with a wrong pointer
- **Slow**: Crossing the JNI boundary has overhead (~50–100 ns per call)
- **Platform-specific**: Must compile native code for each OS/architecture
- **GC interaction**: Must manually pin objects (`GetPrimitiveArrayCritical`) to prevent the GC from moving them while C code holds a pointer
- **Debugging**: If native code crashes, you get a core dump, not a nice stack trace

## Project Panama: The Modern Way

**Project Panama** (Foreign Function & Memory API, finalized in Java 22) provides safe, efficient native interop without JNI.

### Calling a C Function with Panama

Let's call the standard C `strlen` function:

```java
import java.lang.foreign.*;
import java.lang.invoke.MethodHandle;

public class PanamaDemo {
    public static void main(String[] args) throws Throwable {
        // Get a handle to the C standard library
        Linker linker = Linker.nativeLinker();
        SymbolLookup stdlib = linker.defaultLookup();

        // Look up strlen
        MethodHandle strlen = linker.downcallHandle(
            stdlib.find("strlen").orElseThrow(),
            FunctionDescriptor.of(
                ValueLayout.JAVA_LONG,              // return type: size_t (long)
                ValueLayout.ADDRESS                  // parameter: const char*
            )
        );

        // Allocate a C string
        try (Arena arena = Arena.ofConfined()) {
            MemorySegment cString = arena.allocateFrom("Hello, Panama!");
            long length = (long) strlen.invoke(cString);
            System.out.println("Length: " + length);  // 14
        }  // Memory automatically freed when arena closes
    }
}
```

### Key Concepts

#### Memory Segments
Type-safe wrappers around native memory pointers:

```java
try (Arena arena = Arena.ofConfined()) {
    // Allocate 100 bytes of native memory
    MemorySegment segment = arena.allocate(100);

    // Write an int at offset 0
    segment.set(ValueLayout.JAVA_INT, 0, 42);

    // Read it back
    int value = segment.get(ValueLayout.JAVA_INT, 0);  // 42
}
```

#### Arenas
Manage the lifecycle of native memory. When the arena closes, all its allocations are freed:

| Arena Type           | Behavior                                        |
| -------------------- | ----------------------------------------------- |
| `Arena.ofConfined()` | Thread-confined, closed explicitly              |
| `Arena.ofShared()`   | Can be accessed from multiple threads           |
| `Arena.ofAuto()`     | Closed by GC (like `ByteBuffer.allocateDirect`) |
| `Arena.global()`     | Never closed (lives forever)                    |

#### Function Descriptors
Describe the signature of a C function in terms of JVM-compatible layouts:

```java
FunctionDescriptor.of(
    ValueLayout.JAVA_INT,       // return type
    ValueLayout.ADDRESS,        // first parameter (pointer)
    ValueLayout.JAVA_LONG       // second parameter (long)
)
```

### Panama vs JNI

| Aspect                | JNI                                            | Panama                                                |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| **Boilerplate**       | C header generation, manual implementation     | Pure Java, no C code needed                           |
| **Safety**            | Easy to crash JVM                              | Type-safe memory access, bounds checking              |
| **Performance**       | ~50-100 ns per call                            | ~5-10 ns per call (approaching JVM method call speed) |
| **Memory management** | Manual (GetPrimitiveArrayCritical, Release...) | Arena-based, automatic                                |
| **Compilation**       | Need C compiler per platform                   | Pure Java — no native compilation                     |
| **Debugging**         | Core dumps                                     | Java exceptions                                       |

### Using Panama from Scala

```scala
import java.lang.foreign.*
import java.lang.invoke.MethodHandle

val linker = Linker.nativeLinker()
val lookup = linker.defaultLookup()

val abs: MethodHandle = linker.downcallHandle(
  lookup.find("abs").orElseThrow(),
  FunctionDescriptor.of(ValueLayout.JAVA_INT, ValueLayout.JAVA_INT)
)

val result = abs.invoke(-42).asInstanceOf[Int]
println(result)  // 42
```

### jextract: Auto-Generate Bindings

**jextract** is a tool that reads C header files and generates Java code for Panama:

```bash
jextract --source -t com.example.bindings /usr/include/math.h
```

This generates Java classes with method handles for every function in `math.h`. No manual binding code needed.

## Scala Native: The Alternative Path

For Scala specifically, there's another option: **Scala Native**. It compiles Scala directly to native code via LLVM — no JVM at all:

```scala
// Scala Native — direct C interop
import scalanative.unsafe.*
import scalanative.libc.stdlib

@extern
object mylib:
  def add(a: CInt, b: CInt): CInt = extern

@main def run(): Unit =
  val result = mylib.add(3, 4)
  println(result)
```

Scala Native has different trade-offs:
- **No JVM at all**: Instant startup, small binary
- **No JIT**: Throughput depends on LLVM optimization
- **Direct C interop**: First-class, no bridges
- **Limited ecosystem**: Not all Scala libraries work (no Java libraries)

For JVM Scala projects that need C interop, Panama is the way forward. Scala Native is for when you don't want the JVM at all.

## Key Takeaways

- **JNI** works but is painful: boilerplate, unsafe, slow boundary crossing
- **Project Panama** (Java 22+) replaces JNI with safe, fast, pure-Java native interop
- Panama uses **Memory Segments** (safe pointers) and **Arenas** (lifecycle management)
- Panama calls are **5-10x faster** than JNI calls
- **jextract** auto-generates Java bindings from C header files
- **Scala Native** is an alternative that compiles Scala directly to native code (no JVM)

---

[← Previous: Module System](23-module-system.md) · [Next: Language Ecosystem →](25-language-ecosystem.md)
