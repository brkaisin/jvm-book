# Chapter 4 — The Class Loader Subsystem

[← Part II](README.md) · [Next: Bytecode →](05-bytecode.md)

---

## What Is Class Loading?

When you write `new ArrayList()` or call `MyService.process()`, the JVM needs to find the bytecode for `ArrayList` or `MyService`, load it into memory, and prepare it for use. This is the job of the **class loader subsystem**.

Here's the key design principle: **class loading is lazy**. The JVM doesn't load every class at startup. It loads each class the first time it's needed — when you first create an instance, call a static method, or access a static field.

Think of it like a library: the JVM doesn't photocopy every book when you walk in. It goes to the shelf only when you ask for a specific title.

## The Class Loading Lifecycle

When a class is loaded, it goes through five phases:

```
  ┌──────────┐     ┌──────────────────────────────────┐     ┌────────────────┐
  │          │     │           LINKING                 │     │                │
  │ LOADING  │────▶│ Verification → Preparation →     │────▶│ INITIALIZATION │
  │          │     │                  Resolution       │     │                │
  └──────────┘     └──────────────────────────────────┘     └────────────────┘
```

### 1. Loading

The class loader reads the raw bytes of the `.class` file and creates a `java.lang.Class` object. The bytes can come from:
- A `.class` file on disk
- A JAR file
- Over the network
- Generated at runtime (dynamic proxies, bytecode engineering libraries like ASM or ByteBuddy)

### 2. Verification

The bytecode verifier checks that the class file is valid and safe:
- Magic number is `0xCAFEBABE` (yes, really — that's the first 4 bytes of every `.class` file)
- Bytecode doesn't do anything illegal (stack underflow, type mismatches, etc.)
- Access modifiers are respected

### 3. Preparation

Static fields are allocated and set to **default values** (not the values in your code yet):
- `int` → `0`
- `boolean` → `false`
- Object references → `null`

### 4. Resolution

Symbolic references (like the string `"java/util/ArrayList"`) are resolved to actual references in memory. This can happen eagerly or lazily depending on the JVM implementation.

### 5. Initialization

Now the class's static initializer runs. This is where:
- Static fields get their actual assigned values
- `static { }` blocks execute (in Java)
- Scala `object` bodies execute

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

## The Three Built-In Class Loaders

The JVM has a hierarchy of class loaders, each responsible for loading different classes:

```
┌─────────────────────────┐
│   Bootstrap ClassLoader  │  ← Loads core Java classes (java.lang.*, java.util.*, etc.)
│   (written in C/C++)     │     From: JDK's internal modules
└───────────┬─────────────┘
            │ parent
┌───────────▼─────────────┐
│   Platform ClassLoader   │  ← Loads platform/extension classes
│   (was "Extension")      │     From: JDK's platform modules
└───────────┬─────────────┘
            │ parent
┌───────────▼─────────────┐
│  Application ClassLoader │  ← Loads YOUR classes
│   (aka "System")         │     From: classpath (-cp), module path
└─────────────────────────┘
```

- **Bootstrap ClassLoader**: Loads the fundamental classes — `java.lang.Object`, `java.lang.String`, `java.util.List`, etc. It's implemented in native code (C/C++), so you can't see it as a Java object. If you call `String.class.getClassLoader()`, you get `null` — that's the bootstrap loader.

- **Platform ClassLoader**: Loads the JDK's platform modules that aren't part of the core (like `java.sql`, `java.xml`). Before Java 9, this was called the "Extension ClassLoader."

- **Application ClassLoader**: Loads your application classes from the classpath or module path. This is the loader that finds your compiled Scala/Java code and your dependencies (JARs on the classpath).

## The Parent Delegation Model

When a class needs to be loaded, the class loaders follow a specific protocol:

1. The Application ClassLoader is asked to load `com.example.MyClass`
2. Before looking itself, it **delegates to its parent** (Platform ClassLoader)
3. Platform ClassLoader delegates to **its parent** (Bootstrap ClassLoader)
4. Bootstrap ClassLoader tries to find the class — it can't (it's not a core class)
5. Platform ClassLoader tries — it can't either
6. Application ClassLoader finally tries — and finds it on the classpath!

```
Request: load "com.example.MyClass"

Application CL ──delegate──▶ Platform CL ──delegate──▶ Bootstrap CL
                                                         │
                                                    ✗ Not found
                                                         │
                              Platform CL ◀──────────────┘
                                  │
                             ✗ Not found
                                  │
Application CL ◀──────────────────┘
     │
✓ Found on classpath!
```

**Why this design?** Two reasons:

1. **Security**: You can't create a fake `java.lang.String` class that the JVM would load instead of the real one. The bootstrap loader always gets first dibs on core classes.

2. **Consistency**: Every class loader sees the same `java.lang.Object`. Without delegation, you could end up with multiple incompatible `Object` classes loaded by different loaders.

## Why Classes Loaded by Different Loaders Are Different

Here's a subtle but important point: **the identity of a class is determined by its name AND its class loader**.

If ClassLoader A loads `com.example.Foo` and ClassLoader B also loads `com.example.Foo` (from the same `.class` file!), the JVM treats them as **two different classes**. You can't cast one to the other. This is called **class loader isolation**.

```java
Class<?> fooA = classLoaderA.loadClass("com.example.Foo");
Class<?> fooB = classLoaderB.loadClass("com.example.Foo");

System.out.println(fooA == fooB);  // false!
System.out.println(fooA.getName().equals(fooB.getName()));  // true — same name, different class
```

This might seem like a bizarre edge case, but it's the foundation for:
- **Application server isolation** (Tomcat, Jetty): Each deployed web app gets its own class loader, so their dependencies don't conflict
- **Plugin systems** (IDEs, build tools): Each plugin can have its own version of a library
- **Hot reloading** (Play Framework, Spring Boot DevTools): Replace a class loader with a new one to pick up changed classes

> **Scala connection**: If you've ever seen a mysterious `ClassCastException` where the types *look* the same, class loader isolation might be the culprit. This commonly happens in sbt when test classes and main classes get loaded by different loaders, or in REPL environments.

## Custom Class Loaders

You can write your own class loader by extending `java.lang.ClassLoader` and overriding `findClass`:

```java
public class MyClassLoader extends ClassLoader {

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        // Read bytes from wherever you want
        byte[] bytes = loadBytesFromCustomSource(name);
        // Define the class from raw bytes
        return defineClass(name, bytes, 0, bytes.length);
    }

    private byte[] loadBytesFromCustomSource(String name) {
        // Could read from a database, generate on the fly, decrypt, etc.
        // ...
    }
}
```

Real-world uses:
- **OSGi** — A module system that uses class loaders for isolation (used in Eclipse IDE)
- **Bytecode manipulation** — Frameworks like Hibernate generate proxy classes at runtime and load them with custom loaders
- **Encrypted code** — Load encrypted `.class` files, decrypt in memory, never touch disk

## Class Unloading

Classes can be **unloaded** (garbage collected) when:
1. There are no live instances of the class
2. The `Class` object itself is unreachable
3. The class loader that loaded it is unreachable

In practice, classes loaded by the bootstrap, platform, and application loaders are **never unloaded** (those loaders live forever). Only classes from custom loaders can be unloaded — which is how hot reloading works: throw away the old class loader and create a new one.

> **Scala REPL**: The Scala REPL (and Ammonite) creates a new class loader for each line you type. This is why you can redefine things in the REPL — each definition is in a fresh class loaded by a fresh loader.

## Metaspace: Where Class Metadata Lives

The metadata for loaded classes (names, method tables, constant pools, bytecode) needs to live somewhere. Since Java 8, this area is called **Metaspace** and lives in *native memory* (outside the Java heap).

Before Java 8, this was called **PermGen** (Permanent Generation) and was part of the heap. PermGen had a fixed size and was a common source of `OutOfMemoryError: PermGen space` — especially in application servers where classes were loaded and reloaded frequently.

Metaspace grows automatically (up to the system's available memory) and can be capped with `-XX:MaxMetaspaceSize`. We'll cover this more in [Chapter 6](06-runtime-data-areas.md).

## Example: Watching Class Loading in Action

You can see exactly which classes the JVM loads by adding a flag:

```bash
java -verbose:class -jar myapp.jar
```

Output (truncated):
```
[0.001s][info][class,load] java.lang.Object source: jrt:/java.base
[0.001s][info][class,load] java.io.Serializable source: jrt:/java.base
[0.002s][info][class,load] java.lang.Comparable source: jrt:/java.base
[0.002s][info][class,load] java.lang.String source: jrt:/java.base
...
[0.145s][info][class,load] com.example.Main source: file:/app/myapp.jar
[0.147s][info][class,load] scala.Predef$ source: file:/app/lib/scala-library.jar
```

Notice how `java.lang.Object` is loaded first (everything extends it), and your application classes come much later.

## Key Takeaways

- Class loading is **lazy** — classes are loaded on first use, not at startup
- Three built-in loaders form a hierarchy: **Bootstrap → Platform → Application**
- The **parent delegation model** ensures security (can't replace core classes) and consistency
- A class's identity = its name + its class loader — same name, different loader = different class
- Custom class loaders enable **isolation** (app servers), **hot reloading**, and **plugin systems**
- Class metadata lives in **Metaspace** (native memory since Java 8, replacing the fixed-size PermGen)

---

[← Part II](README.md) · [Next: Bytecode →](05-bytecode.md)
