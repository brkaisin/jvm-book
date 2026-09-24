# Chapter 23 — The Module System (JPMS) and Integrity by Default

## The Classpath Problem

Before Java 9, the JVM loaded classes from the **classpath**: a flat, unordered list of JARs and directories. It worked, but it had serious problems:

1. **No encapsulation**: every `public` class in every JAR was visible to every other JAR. There was no way to say "public inside my library, private to everyone else."

2. **Dependency hell**: if two JARs contained different versions of the same class, whichever came first on the classpath won. No error, no warning, just subtle bugs.

3. **Monolithic JDK**: the whole JDK was one big blob. Even a tiny application shipped with `rt.jar` (60+ MB) and its thousands of classes.

```text
Classpath: lib/guava.jar:lib/commons-io.jar:lib/myapp.jar
           ↑             ↑                  ↑
           All public classes visible to everyone
           No boundaries, no protection
```

## The Module System (Project Jigsaw)

Java 9 introduced the **Java Platform Module System (JPMS)** to fix this. A module is a named, self-describing group of packages with explicit:

- **Dependencies** (`requires`): which other modules it needs
- **Exports** (`exports`): which of its packages other modules may use
- **Opens** (`opens`): which packages other modules may inspect with deep reflection
- **Services** (`provides` / `uses`): service provider interfaces

### Defining a Module

Create a `module-info.java` at the root of your source tree:

```java
// module-info.java
module com.example.myapp {
    requires java.sql;           // I need the SQL module
    requires java.logging;       // I need the logging module

    exports com.example.api;     // Others can see my API package
    // com.example.internal is NOT exported: truly hidden

    opens com.example.model to com.google.gson;  // Allow reflection for this package
}
```

### Strong Encapsulation

This is the key change. Before modules, a `public` class was usable by anyone. With modules, a `public` class is only accessible if its package is **exported**:

```text
┌──────────────────────────┐          ┌─ module com.example.mylib ──────┐
│ module com.example.myapp │          │                                 │
│                          │ can use  │  ┌───────────────────────────┐  │
│   requires               │ MyService│  │ com.example.api           │  │
│   com.example.mylib      │──────────┼─▶│ (exported)                │  │
│                          │          │  └───────────────────────────┘  │
│                          │ compile  │                                 │
│                          │ error    │  ┌───────────────────────────┐  │
│                          │          │  │ com.example.internal      │  │
│                          │╌╌╌╌╌╌╌╌╌╌┼╌▶│ (not exported)            │  │
│                          │          │  └───────────────────────────┘  │
└──────────────────────────┘          └─────────────────────────────────┘
```

This is real encapsulation, not just a naming convention like `impl` or `internal` in a package name.

### The Modularized JDK

The JDK itself is split into about 70 modules. They form a graph, with `java.base` at the bottom:

```text
                        ┌─────────────────────┐
                        │       java.se       │
                        │    (aggregator)     │
                        └──────────┬──────────┘
       ╭──────────────┬────────────┼──────────────┬────────────────╮
       ▼              ▼            ▼              ▼                ▼
 java.logging ◀── java.sql ──▶ java.xml ◀── java.desktop     java.net.http
       │              │            │              │                │
       ╰──────────────┴────────────┼──────────────┴────────────────╯
                                   ▼
             ┌───────────────────────────────────────────┐
             │                 java.base                 │ ◀── jdk.jfr
             │     (Object, String, collections...)      │
             └───────────────────────────────────────────┘
```

Every module implicitly requires `java.base`. You can list the modules of your JDK with `java --list-modules`, and see what a module requires with `java --describe-module java.sql`.

### Custom Runtimes with jlink

Because the JDK is modular, you can build a **custom runtime** containing only the modules your application needs:

```bash
jlink --add-modules java.base,java.sql \
      --strip-debug --no-header-files --no-man-pages \
      --output my-runtime

# my-runtime is a few tens of MB instead of a full JDK
my-runtime/bin/java -jar myapp.jar
```

<span class="since">Java 24</span> Traditionally, `jlink` read the modules from the `jmods/` directory of the JDK. **JEP 493** lets a JDK be built without those JMOD files (about 25% smaller); `jlink` then extracts the modules straight from the running JDK's own image. It is a build-time option (`--enable-linkable-runtime`) that each JDK vendor decides whether to enable, so on some distributions `$JAVA_HOME/jmods` simply doesn't exist, and `jlink` still works. There are a few limits: no cross-platform linking, and the resulting image can't itself contain `jlink`.

To find out which modules a classpath application actually uses, run `jdeps`:

```bash
jdeps --print-module-deps --ignore-missing-deps myapp.jar
# java.base,java.logging,java.sql
```

The output can be passed directly to `jlink --add-modules`. This works for Scala applications too (include `scala-library.jar` and your other dependencies on the path).

## Module Import Declarations <span class="since">Java 25</span>

Modules were designed for *packaging*, but Java 25 (JEP 511) also gives them a small convenience in *source code*: you can import every exported package of a module in one line.

```java
import module java.base;      // java.util.*, java.io.*, java.time.*, java.util.stream.* …
import module java.sql;       // java.sql.*, javax.sql.* (and java.xml via requires transitive)

public class Report {
    List<Path> files = new ArrayList<>();   // List, Path, ArrayList: all imported
}
```

A few things to know:

- It imports the **public top-level types** of every package the module exports, plus those of modules it `requires transitive`. `import module java.se;` gives you the whole Java SE API.
- Your code does **not** need to be in a module to use it. It is purely a compile-time shorthand.
- Ambiguities are resolved by the more specific import. If you `import module java.base;` and `import module java.desktop;`, then `List` is ambiguous (`java.util.List` vs `java.awt.List`); adding `import java.util.List;` fixes it.
- **Compact source files** (Java 25, JEP 512, the `void main()` style) import `java.base` automatically.

> **Meanwhile, in Scala land:** Scala already imports `java.lang._`, `scala._` and `Predef._` implicitly, and wildcard imports (`import java.util.*`) are everyday style. There is no Scala equivalent of `import module`, and you don't really need one.

## Integrity by Default

Strong encapsulation was step one of a longer story the JDK team now calls **integrity by default**: the JVM should be able to *trust* what the code says. A `private` field stays private, a `final` field stays final, and native code only runs when the application owner has agreed to it. That trust is what lets the JIT constant-fold `final` fields, lets the JDK evolve its internals, and makes security reasoning possible.

Each "superpower" that could break these guarantees is being put behind an explicit command-line opt-in, usually in two steps: first a warning, then an error by default.

<p class="timeline-title">Integrity by default: milestones</p>
<ol class="timeline">
<li><span class="when">Java 9</span>Strong encapsulation introduced, illegal-access warnings</li>
<li><span class="when">Java 16</span>Internals encapsulated by default (JEP 396)</li>
<li><span class="when">Java 17</span>Internals strongly encapsulated, <code>--illegal-access</code> removed (JEP 403)</li>
<li><span class="when">Java 23</span>Unsafe memory access deprecated for removal (JEP 471)</li>
<li><span class="when">Java 24</span>Security Manager disabled (JEP 486)<br/>JNI and FFM warnings (JEP 472)<br/>Unsafe memory-access warnings (JEP 498)</li>
<li><span class="when">Java 26</span>Final-field mutation warnings (JEP 500)</li>
</ol>

| Superpower                                  | Opt-in flag                                   | Status (JDK 27)                         |
| ------------------------------------------- | --------------------------------------------- | --------------------------------------- |
| Deep reflection into JDK internals          | `--add-opens java.base/java.lang=ALL-UNNAMED` | Denied without the flag (since 17)      |
| Using non-exported JDK packages             | `--add-exports …`                             | Denied without the flag (since 17)      |
| Loading native code (JNI, FFM)              | `--enable-native-access=ALL-UNNAMED`          | Warning; will become an error           |
| `sun.misc.Unsafe` memory access             | `--sun-misc-unsafe-memory-access=allow`       | Warning; methods will be removed        |
| Mutating `final` fields with reflection     | `--enable-final-field-mutation=ALL-UNNAMED`   | Warning; will become an error           |

### Opening Packages: `--add-opens`

Code on the classpath can no longer reach into JDK internals with `setAccessible(true)`. Since Java 17, this simply fails:

```text
java.lang.reflect.InaccessibleObjectException: Unable to make field private final
byte[] java.lang.String.value accessible: module java.base does not "opens java.lang"
to unnamed module @6d06d69c
```

The fix, until the library stops doing it, is `--add-opens`:

```bash
java --add-opens java.base/java.lang=ALL-UNNAMED \
     --add-opens java.base/sun.nio.ch=ALL-UNNAMED \
     -jar myapp.jar
```

(The old `--illegal-access=permit` switch that used to relax this globally is obsolete since Java 17 and ignored.)

### Native Access: `--enable-native-access` <span class="since">Java 24</span>

Loading a native library through JNI (`System.loadLibrary`) or calling C through the FFM API can crash the JVM or corrupt memory, so it is now a *restricted* operation. Since JDK 24 (JEP 472), the first time a module does it without permission you get a warning like this:

```text
WARNING: A restricted method in java.lang.System has been called
WARNING: System::loadLibrary has been called by com.example.Native in an unnamed module
WARNING: Use --enable-native-access=ALL-UNNAMED to avoid a warning for callers in this module
WARNING: Restricted methods will be blocked in a future release unless native access is enabled
```

Grant access explicitly with `--enable-native-access=ALL-UNNAMED` (classpath code) or `--enable-native-access=my.module`, or add `Enable-Native-Access: ALL-UNNAMED` to the manifest of an executable JAR. `--illegal-native-access=allow|warn|deny` controls what happens otherwise (default `warn`). See [Chapter 24](24-native-interop.md) for the details.

### Unsafe Memory Access <span class="since">Java 24</span>

The memory-access methods of `sun.misc.Unsafe` (`getInt`, `putLong`, `compareAndSwapObject`, `allocateMemory`…) were deprecated for removal in Java 23 (JEP 471). Since Java 24 (JEP 498) the first use prints a warning. `--sun-misc-unsafe-memory-access=allow|warn|debug|deny` controls this (the default is still `warn` in JDK 27), and the plan is to switch to `deny` and then remove the methods. The replacements are `VarHandle` (for on-heap fields and arrays) and the FFM API's `MemorySegment` (for off-heap memory).

### Final Means Final <span class="since">Java 26</span>

Surprisingly, until now a `final` instance field could be changed with reflection after `setAccessible(true)`. That makes `final` a promise the JIT can't fully trust. JEP 500 starts closing this hole: in JDK 26 and 27, mutating a `final` field via `Field.set` (or `MethodHandles.Lookup.unreflectSetter`) prints a warning:

```text
WARNING: Final field name in p.Config has been mutated by class com.foo.Injector in unnamed module
```

- Opt in with `--enable-final-field-mutation=ALL-UNNAMED` (or a list of module names), or the `Enable-Final-Field-Mutation: ALL-UNNAMED` manifest attribute.
- `--illegal-final-field-mutation=allow|warn|debug|deny` controls the rest; the default is `warn`, and a future release will make it `deny`.
- This is *in addition* to `--add-opens`: you need the package to be open **and** final-field mutation enabled.
- Record fields and hidden classes were already immune. Serialization libraries should use `sun.reflect.ReflectionFactory` rather than poking final fields.

> [!IMPORTANT]
> The `debug` modes (`--illegal-final-field-mutation=debug`, `--sun-misc-unsafe-memory-access=debug`) print a stack trace at each offending call. Run your test suite once with them to find out *which* library needs the flag, instead of adding flags blindly.

## Impact on Scala

### The Good

- **Smaller runtime images**: Scala applications can ship with a trimmed JDK built by `jlink`.
- **Better encapsulation**: Scala libraries can ship a `module-info.class` (or at least an `Automatic-Module-Name`) to hide internal packages from Java users.
- **A more trustworthy JVM**: the JIT can optimize `final` fields more aggressively once they really are final, which helps immutable-by-default code like Scala's `case class`es.

### The Challenges

**Split packages**: JPMS forbids two modules from containing the same package. Some older libraries have overlapping packages, which breaks as soon as they are put on the module path. On the classpath this is not checked.

**Reflective access to internals**: Scala tools and libraries historically used reflection and `Unsafe` on JDK internals. Here is where you are likely to meet the integrity flags:

- **Lazy vals**: Scala 3 compiled `lazy val` using `sun.misc.Unsafe`, which triggers the JDK 24+ warning. Scala 3.8 (and therefore the 3.9 LTS) switched to a `VarHandle`-based encoding. On older Scala 3 versions you may see the warning (or need `--sun-misc-unsafe-memory-access=allow`).
- **Akka / Pekko and other high-performance libraries**: historically used `Unsafe` for fast atomics and off-heap buffers; recent versions are moving to `VarHandle`.
- **Serialization, dependency injection, mocking**: tend to set private and `final` fields reflectively, so they are the ones affected by JEP 500.
- **Native bindings** (e.g., compression, crypto, RocksDB, Netty's native transports): need `--enable-native-access`.

**The unnamed module**: code on the classpath (not in a named module) lives in the **unnamed module**. It can read all named modules, but named modules can't require it. Most Scala applications run this way, and that's fine: this is why the flags above all say `ALL-UNNAMED`.

### Should Scala Projects Use JPMS?

For most Scala applications: **not really**. The classpath works fine, and sbt and the Scala ecosystem don't push you toward `module-info`. But you do need to be aware of:

- the integrity flags your dependencies need, and the warnings that tell you so;
- module-related errors when upgrading the JDK;
- `jlink`/`jdeps` if you ship a container image and want a smaller runtime.

```scala
// build.sbt: JVM flags for module access and integrity opt-ins
run / fork := true
javaOptions ++= Seq(
  "--add-opens", "java.base/java.lang=ALL-UNNAMED",
  "--add-opens", "java.base/java.lang.invoke=ALL-UNNAMED",
  "--enable-native-access=ALL-UNNAMED"
)
```

> [!TIP]
> `javaOptions` only apply to forked JVMs, so set `fork := true` (for `run`, `Test`, or both). When you package an executable JAR, prefer the manifest attributes (`Enable-Native-Access`, `Add-Opens`) so users don't have to remember the flags.

<div class="takeaways">

## Key Takeaways

- **JPMS** (Java 9) replaces the flat classpath with explicit modules that declare **dependencies** (`requires`) and **visible packages** (`exports`, `opens`)
- Non-exported packages are **truly hidden**, and the JDK itself is split into ~70 modules
- `jlink` builds trimmed runtimes; since Java 24 it can work even on JDKs shipped without JMOD files
- `import module java.base;` (Java 25) is a compile-time shorthand, usable without writing modules
- **Integrity by default**: JDK internals are closed (17), native access warns (24), `Unsafe` memory access warns (24), and final-field mutation warns (26). The warnings become errors later
- Most Scala projects still run on the **classpath** (unnamed module), hence the `ALL-UNNAMED` flags
- Scala 3.8+ moved lazy vals off `sun.misc.Unsafe`; upgrade rather than silencing the warning

</div>
