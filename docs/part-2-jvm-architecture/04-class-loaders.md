# Chapter 4 — The Class Loader Subsystem

## What Is Class Loading?

When you write `new ArrayList()` or call `MyService.process()`, the JVM needs to find the bytecode for `ArrayList` or `MyService`, load it into memory, and prepare it for use. This is the job of the **class loader subsystem**.

Here's the key design principle: **class loading is lazy**. The JVM doesn't load every class at startup. It loads each class the first time it's needed — when you first create an instance, call a static method, or access a static field.

Think of it like a library: the JVM doesn't photocopy every book when you walk in. It goes to the shelf only when you ask for a specific title.

## The Class Loading Lifecycle

A class goes through three stages before your code can use it: **loading**, **linking** (itself made of three steps), and **initialization**.

```text
                  ┌─────────────────────────────┐
                  │           Loading           │
                  │   find bytes, create Class  │
                  └──────────────┬──────────────┘
                                 ▼
    ┌─ Linking ────────────────────────────────────────────────┐
    │                                                          │
    │ ┌──────────────┐   ┌───────────────┐   ┌──────────────┐  │
    │ │ Verification │──▶│  Preparation  │──▶│  Resolution  │  │
    │ └──────────────┘   └───────────────┘   └───────┬──────┘  │
    │                                                │         │
    └────────────────────────────────────────────────┼─────────┘
                                                     │
                                 ╭───────────────────╯
                                 ▼
                  ┌─────────────────────────────┐
                  │        Initialization       │
                  │   run static initializers   │
                  └─────────────────────────────┘
```

### 1. Loading

The class loader finds the raw bytes of the class and turns them into a `java.lang.Class` object. The bytes can come from:
- A `.class` file on disk
- A JAR file
- The JDK's own runtime image (the `jrt:/` file system, for `java.base` and friends)
- Over the network
- Generated at runtime (dynamic proxies, lambdas, bytecode libraries like ByteBuddy, or the JDK's own [Class-File API](05-bytecode.md#reading-and-generating-bytecode-the-class-file-api))

While parsing, the JVM also runs basic format checks: the file must start with the magic number `0xCAFEBABE` (yes, really — that's the first 4 bytes of every `.class` file), and its version must be one this JVM understands. A class compiled for a newer Java than the one running it fails right here with `UnsupportedClassVersionError`.

### 2. Verification

The bytecode verifier checks that the code is safe to run, without trusting the compiler that produced it:
- Every instruction gets operands of the right type (no treating an `int` as an object reference)
- The operand stack never underflows or overflows
- Jumps land on real instructions, and access modifiers are respected

Modern class files carry a `StackMapTable` attribute (type hints written by the compiler) so verification is a quick single pass rather than an expensive inference.

### 3. Preparation

Static fields are allocated and set to **default values** (not the values in your code yet):
- `int` → `0`
- `boolean` → `false`
- Object references → `null`

### 4. Resolution

Symbolic references (like the string `"java/util/ArrayList"` in the constant pool) are turned into direct references to loaded classes, methods, and fields. The specification lets a JVM do this eagerly or lazily; HotSpot does it lazily, the first time each instruction that uses a reference actually runs.

### 5. Initialization

Now the class's static initializer runs. This is where:
- Static fields get their actual assigned values
- `static { }` blocks execute (in Java)
- Scala `object` bodies execute (an `object` compiles to a class whose static initializer creates the singleton)

```java
// Java
public class Config {
    // Preparation: count = 0
    // Initialization: count = 42
    static int count = 42;

    static {
        System.out.println("Config loaded!");  // Runs during initialization
    }
}
```

```scala
// Scala — objects are initialized lazily on first access
object Config:
  println("Config loaded!")  // Runs when Config is first accessed
  val count = 42
```

The JVM guarantees that initialization happens exactly once, even if many threads touch the class at the same moment. That's why the "holder class" idiom for lazy singletons works, and why Scala `object`s are thread-safe to initialize.

## The Three Built-In Class Loaders

Since Java 9, the JVM ships with three built-in class loaders, arranged in a parent chain:

```text
┌───────────────────────────────────────────┐
│           Bootstrap class loader          │
│         native code inside the JVM        │
│   java.base, java.xml, java.logging, ...  │
└─────────────────────▲─────────────────────┘
                      │ parent
┌─────────────────────┴─────────────────────┐
│           Platform class loader           │
│        java.sql, java.net.http, ...       │
└─────────────────────▲─────────────────────┘
                      │ parent
┌─────────────────────┴─────────────────────┐
│          Application class loader         │
│  your classes: classpath and module path  │
└───────────────────────────────────────────┘
```

- **Bootstrap class loader**: Loads the fundamental classes — `java.lang.Object`, `java.lang.String`, `java.util.List`, and most of the core modules. It's part of the JVM itself (written in C++), so there's no Java object for it. If you call `String.class.getClassLoader()`, you get `null` — that's the bootstrap loader.

- **Platform class loader**: Loads the JDK modules that don't need bootstrap privileges, such as `java.sql` and `java.net.http`. Before Java 9, its predecessor was the "extension class loader", which loaded JARs from `jre/lib/ext`. That extension mechanism is gone.

- **Application class loader** (also called the *system* class loader): Loads your application classes from the classpath or module path. This is the loader that finds your compiled Scala/Java code and your dependencies.

You can check which loader owns a class yourself:

```java
// Loaders.java
void main() {
    IO.println(String.class.getClassLoader());                // null (bootstrap)
    IO.println(java.sql.Connection.class.getClassLoader());   // ...PlatformClassLoader@...
    IO.println(getClass().getClassLoader());                  // ...AppClassLoader@...
}
```

Fun detail: compile this with `javac` and run it with `java Loaders`, and the last line prints `AppClassLoader`. Run it directly as a source file (`java Loaders.java`) and it prints `MemoryClassLoader` instead: the source launcher compiles your file in memory and defines the class with its own custom loader.

## The Parent Delegation Model

When a class needs to be loaded, the class loaders follow a specific protocol:

1. The application class loader is asked to load `com.example.MyClass`
2. Before looking itself, it **delegates to its parent** (the platform class loader)
3. The platform class loader delegates to **its parent** (the bootstrap class loader)
4. The bootstrap class loader tries to find the class — it can't (it's not a core class)
5. The platform class loader tries — it can't either
6. The application class loader finally tries — and finds it on the classpath!

```text
┌────────────────┐          ┌────────────────┐          ┌────────────────┐
│ Application CL │          │  Platform CL   │          │  Bootstrap CL  │
└───────┬────────┘          └───────┬────────┘          └───────┬────────┘
        │ load com.example.MyClass  │                           │
        │──────────────────────────▶│                           │
        │                           │ load com.example.MyClass  │
        │                           │──────────────────────────▶│
        │                           │                           │
        │                           │        not found          │
        │                           │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│
        │                           │                           │
        │        not found          │                           │
        │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│                           │
        │                           │                           │
┌───────┴──────────────────┐
│  searches the classpath  │
│    and finds MyClass     │
└──────────────────────────┘
```

**Why this design?** Two reasons:

1. **Protection of the core**: You can't create a fake `java.lang.String` class that the JVM would load instead of the real one. The bootstrap loader always gets first dibs on core classes.

2. **Consistency**: Every class loader sees the same `java.lang.Object`. Without delegation, you could end up with multiple incompatible `Object` classes loaded by different loaders.

> [!NOTE]
> With the module system (Java 9+), the built-in loaders are a bit smarter than "always ask the parent first". Each loader knows which *packages* belong to which *modules*. When asked for `java.sql.Connection`, the application loader sees that package `java.sql` lives in a module owned by the platform loader and hands the request straight to it. The observable result is the same as classic delegation, just faster and stricter: two modules can't both define the same package. More in [Chapter 23](../part-7-ecosystem/23-module-system.md).

> [!NOTE]
> Class loaders used to be one half of Java's sandbox: the other half was the **Security Manager**, which checked permissions based on where a class had been loaded from. The Security Manager was deprecated in Java 17 and **permanently disabled in Java 24** (JEP 486). Today, class loaders are about *isolation and namespacing*, not about sandboxing untrusted code. If you need to contain untrusted code, use OS-level isolation (processes, containers).

## Why Classes Loaded by Different Loaders Are Different

Here's a subtle but important point: **the identity of a class is determined by its name AND its class loader**.

If loader A loads `com.example.Foo` and loader B also loads `com.example.Foo` (from the same `.class` file!), the JVM treats them as **two different classes**. You can't cast one to the other. This is called **class loader isolation**.

```java
Class<?> fooA = classLoaderA.loadClass("com.example.Foo");
Class<?> fooB = classLoaderB.loadClass("com.example.Foo");

System.out.println(fooA == fooB);                           // false!
System.out.println(fooA.getName().equals(fooB.getName()));  // true — same name, different class
```

This might seem like a bizarre edge case, but it's the foundation for:
- **Application server isolation** (Tomcat, Jetty): Each deployed web app gets its own class loader, so their dependencies don't conflict
- **Plugin systems** (IDEs, build tools): Each plugin can have its own version of a library
- **Hot reloading** (Spring Boot DevTools, Play's dev mode): Replace a class loader with a new one to pick up changed classes

> **Scala connection**: If you've ever seen a mysterious `ClassCastException` where the types *look* the same (`Foo cannot be cast to Foo`), class loader isolation is almost certainly the culprit. sbt, for example, runs `run` and `test` in a layered stack of class loaders (Scala library, dependencies, your project) so it can throw away just the top layer between runs. If a library caches a class from one layer and your code gets it from another, you get exactly this error.

## Custom Class Loaders

You can write your own class loader by extending `java.lang.ClassLoader` and overriding `findClass`:

```java
public class MyClassLoader extends ClassLoader {

    public MyClassLoader(ClassLoader parent) {
        super(parent);  // keep parent delegation
    }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        // Read bytes from wherever you want
        byte[] bytes = loadBytesFromCustomSource(name);
        // Define the class from raw bytes
        return defineClass(name, bytes, 0, bytes.length);
    }

    private byte[] loadBytesFromCustomSource(String name) throws ClassNotFoundException {
        // Could read from a database, generate on the fly, decrypt, etc.
        throw new ClassNotFoundException(name);
    }
}
```

`loadClass` (which you normally don't override) implements the delegation: it asks the parent first and calls your `findClass` only if the parent fails.

Real-world uses:
- **OSGi** — A module system that uses class loaders for isolation (used in the Eclipse IDE)
- **Code generation** — Frameworks like Hibernate and Mockito generate proxy classes at runtime and define them in a suitable loader
- **Build tools and test runners** — sbt, Gradle, and Maven Surefire isolate the build from the code being built

### Hidden Classes

Many generated classes don't need a name at all. Since Java 15, frameworks can define **hidden classes** (`MethodHandles.Lookup.defineHiddenClass`): classes that can't be found by name, can't be referenced from other bytecode, and can be unloaded as soon as nobody uses them. The JDK itself uses them for lambdas — every lambda's implementation class is a hidden class spun up at runtime (you'll see names like `Main$$Lambda/0x...` in stack traces). For framework authors, hidden classes replace the old, unsupported `sun.misc.Unsafe.defineAnonymousClass`.

## Class Unloading

Classes can be **unloaded** (garbage collected) when:
1. There are no live instances of the class
2. The `Class` object itself is unreachable
3. The class loader that loaded it is unreachable

In practice, classes loaded by the bootstrap, platform, and application loaders are **never unloaded** (those loaders live forever). Only classes from custom loaders (and hidden classes) can be unloaded — which is how hot reloading works: throw away the old class loader and create a new one.

> **Scala REPL**: The REPL compiles each line you type into fresh wrapper classes with unique names (`rs$line$3`, `$line3.$read`, depending on the Scala version) and loads them through its own class loader. When you redefine `val x`, you get a *new* class that shadows the old one — nothing is modified in place.

## Metaspace: Where Class Metadata Lives

The metadata for loaded classes (names, method tables, constant pools, bytecode) needs to live somewhere. Since Java 8, this area is called **Metaspace** and lives in *native memory* (outside the Java heap).

Before Java 8, this was called **PermGen** (Permanent Generation) and was part of the heap. PermGen had a fixed size and was a common source of `OutOfMemoryError: PermGen space` — especially in application servers where classes were loaded and reloaded frequently.

Metaspace grows automatically (up to the system's available memory) and can be capped with `-XX:MaxMetaspaceSize`. We'll cover this more in [Chapter 6](06-runtime-data-areas.md#the-method-area--metaspace--where-class-metadata-lives).

## Skipping the Work: CDS and the AOT Cache

Loading, verifying, and linking thousands of classes at every startup is repetitive: the result is the same every time you start the same application. So the JVM can **save that work and reuse it**.

- **Class Data Sharing (CDS)** stores pre-parsed class metadata in an archive file that is memory-mapped at startup. The JDK ships with a default CDS archive for its own core classes (on by default since Java 12), which is why they load so quickly. AppCDS extended this to application classes.
- **The AOT cache** <span class="since">Java 24</span> is CDS's more ambitious successor, from Project Leyden. JEP 483 (*Ahead-of-Time Class Loading & Linking*) lets you do a **training run** of your app; the JVM records which classes it used and stores them in the cache **already loaded and linked**. In production, those classes are available instantly, as if the JVM had done the work before `main` started.

```bash
# Java 25+: training run, writes the cache on exit
java -XX:AOTCacheOutput=app.aot -cp app.jar com.example.App

# Production run: classes come pre-loaded and pre-linked from the cache
java -XX:AOTCache=app.aot -cp app.jar com.example.App
```

(On Java 24, creating the cache takes two commands, `-XX:AOTMode=record` then `-XX:AOTMode=create`; Java 25's JEP 514 folded them into the single `-XX:AOTCacheOutput` step.)

Laziness is preserved: the cache doesn't change *when* your classes are initialized or what your program does, it only removes the loading and linking cost. The cache must be used with the same JDK build and a compatible classpath (JAR files only); if it doesn't match, the JVM quietly ignores it, unless you pass `-XX:AOTMode=required` (JDK 27; spelled `on` in JDK 24–26) to fail fast.

> [!TIP]
> The AOT cache keeps growing with each release: method profiles in Java 25, and compiled code is proposed for Java 28. See [Chapter 7](07-execution-engine.md#the-aot-cache-project-leyden) for the full picture of how it speeds up warmup, not just class loading.

## Example: Watching Class Loading in Action

You can see exactly which classes the JVM loads by adding a flag:

```bash
java -verbose:class -jar myapp.jar
```

Output (truncated):

```text
[0.008s][info][class,load] java.lang.Object source: shared objects file
[0.009s][info][class,load] java.io.Serializable source: shared objects file
[0.009s][info][class,load] java.lang.Comparable source: shared objects file
[0.009s][info][class,load] java.lang.CharSequence source: shared objects file
...
[0.145s][info][class,load] com.example.Main source: file:/app/myapp.jar
[0.147s][info][class,load] scala.Predef$ source: file:/app/lib/scala-library.jar
```

Notice how `java.lang.Object` is loaded first (everything extends it), and your application classes come much later. `source: shared objects file` means the class came from the CDS archive rather than being parsed from scratch. Run with an AOT cache and your own classes will show that source too.

<div class="takeaways">

## Key Takeaways

- Class loading is **lazy** — classes are loaded on first use, not at startup
- Each class goes through **loading → linking (verification, preparation, resolution) → initialization**
- Three built-in loaders form a hierarchy: **Bootstrap → Platform → Application** (since Java 9; the old extension loader is gone)
- The **parent delegation model** protects core classes and keeps a single `java.lang.Object`; with modules, delegation is guided by package ownership
- A class's identity = its name + its class loader — same name, different loader = different class
- Custom class loaders enable **isolation** (app servers, build tools), **hot reloading**, and **plugin systems**; they are no longer a security sandbox (the Security Manager is gone since Java 24)
- Class metadata lives in **Metaspace** (native memory since Java 8, replacing the fixed-size PermGen)
- **CDS** and the **AOT cache** (Java 24+) let the JVM start with classes already loaded and linked from a previous training run

</div>
