# Chapter 23 — The Module System (JPMS)

[← Part VII](README.md) · [Next: Native Interop →](24-native-interop.md)

---

## The Classpath Problem

Before Java 9, the JVM loaded classes from the **classpath** — a flat, unordered list of JARs and directories. This worked, but had serious problems:

1. **No encapsulation**: Every `public` class in every JAR was visible to every other JAR. There was no way to make a class "public within my library but private to outsiders."

2. **Dependency hell**: If two JARs include different versions of the same class, whichever appears first on the classpath wins. No error, no warning — just subtle bugs.

3. **Monolithic JDK**: The entire JDK was one giant blob. Even a tiny application loaded `rt.jar` (60+ MB) with thousands of classes it didn't need.

```
Classpath: lib/guava.jar:lib/commons-io.jar:lib/myapp.jar
           ↑             ↑                  ↑
           All public classes visible to everyone
           No boundaries, no protection
```

## The Module System (Project Jigsaw)

Java 9 introduced the **Java Platform Module System (JPMS)** to solve these problems. A module is a named, self-describing collection of packages with explicit:

- **Dependencies** (`requires`): What other modules this module needs
- **Exports** (`exports`): Which packages are visible to other modules
- **Services** (`provides`/`uses`): Service provider interfaces

### Defining a Module

Create a `module-info.java` at the root of your source tree:

```java
// module-info.java
module com.example.myapp {
    requires java.sql;           // I need the SQL module
    requires java.logging;       // I need the logging module

    exports com.example.api;     // Others can see my API package
    // com.example.internal is NOT exported — truly hidden!

    opens com.example.model to com.google.gson;  // Allow reflection for this package
}
```

### Strong Encapsulation

This is the key change. Before modules, if a class was `public`, anyone could use it. With modules, a `public` class is only visible if its package is **exported**:

```
Module com.example.mylib:
  exports com.example.api           ← Visible to other modules
  (does not export com.example.internal)  ← Hidden!

Module com.example.myapp:
  requires com.example.mylib

  can use:    com.example.api.MyService        ✓
  cannot use: com.example.internal.Helper      ✗ (compile error!)
```

This is real encapsulation — not just a naming convention.

### The Modularized JDK

The JDK itself was split into ~70 modules:

```
java.base      ← Always available (Object, String, Math, etc.)
java.sql       ← JDBC
java.logging   ← java.util.logging
java.xml       ← XML parsing
java.desktop   ← AWT, Swing
jdk.httpserver ← Simple HTTP server
jdk.jfr        ← Java Flight Recorder
...
```

You can create a **custom runtime** with only the modules you need:

```bash
jlink --module-path $JAVA_HOME/jmods \
      --add-modules java.base,java.sql \
      --output my-runtime

# my-runtime is ~30 MB instead of ~300 MB
```

## Impact on Scala

### The Good

- **Smaller runtime images**: Scala applications can ship with a trimmed JDK
- **Better encapsulation**: Scala libraries can use modules to hide internal APIs

### The Challenges

**Split packages**: JPMS forbids two modules from containing the same package. Some older libraries (especially in the Java EE ecosystem) have overlapping packages, causing errors.

**Reflective access restrictions**: Many Scala libraries use reflection to access JDK internals. With JPMS, this is blocked by default:

```
WARNING: An illegal reflective access operation has occurred
WARNING: Please consider reporting this to the maintainers of com.example.MyLib
```

The workaround is `--add-opens`:

```bash
java --add-opens java.base/java.lang=ALL-UNNAMED \
     --add-opens java.base/sun.nio.ch=ALL-UNNAMED \
     -jar myapp.jar
```

This is common in:
- **sbt** — Needs reflective access for some operations
- **Akka/Pekko** — Uses `sun.misc.Unsafe` for performance
- **Serialization libraries** — Access private fields via reflection

**The unnamed module**: Code on the classpath (not in a named module) goes into the **unnamed module**, which can read all named modules but can't be required by named modules. Most Scala applications still run on the classpath in the unnamed module.

### Should Scala Projects Use JPMS?

For most Scala projects today: **not yet**. The ecosystem hasn't fully adopted modules, and the classpath still works fine. But you should be aware of:

- The `--add-opens` flags you might need
- The direction the ecosystem is moving
- Module-related errors when upgrading JDK versions

```sbt
// build.sbt — adding JVM flags for module access
javaOptions ++= Seq(
  "--add-opens", "java.base/java.lang=ALL-UNNAMED",
  "--add-opens", "java.base/java.lang.invoke=ALL-UNNAMED"
)
```

## Key Takeaways

- **JPMS** (Java 9) replaces the flat classpath with explicit modules
- Modules declare **dependencies** (`requires`) and **visible packages** (`exports`)
- Non-exported packages are **truly hidden** — stronger than `private`/`package-private`
- The JDK itself is modularized into ~70 modules
- Most Scala projects still use the **classpath** (unnamed module)
- You may need `--add-opens` flags for libraries that use reflection on JDK internals
- JPMS adoption in the Scala ecosystem is gradual

---

[← Part VII](README.md) · [Next: Native Interop →](24-native-interop.md)
