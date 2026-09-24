# Chapter 25 — The JVM Language Ecosystem

## Why So Many Languages on One VM?

The JVM provides a remarkable foundation:
- Mature garbage collectors
- World-class JIT compilers
- Rich threading and concurrency, now including virtual threads
- A vast library ecosystem (Maven Central hosts millions of artifacts)
- Excellent tooling (debuggers, profilers, JFR, monitoring)

Any language that compiles to JVM bytecode gets all of this for free. That's why the JVM hosts a whole family of languages, each bringing different ideas. And because the platform keeps improving (smaller object headers, AOT caches, value objects), every one of them gets faster without changing a line of its compiler.

```text
┌─────────────────────────────────────────┐
│ Java      javac                         │──╮
│ Scala     scalac                        │──┤
│ Kotlin    kotlinc (K2)                  │──┤
│ Clojure   runtime compiler              │──┤
│ Groovy    groovyc                       │──┤
│ JRuby     interpreter + JIT to bytecode │──┤
└─────────────────────────────────────────┘  │
                                             ▼
                               ┌───────────────────────────┐
                               │       JVM bytecode        │
                               │      (.class files)       │
                               └─────────────┬─────────────┘
                                             ▼
                            ┌─────────────────────────────────┐
                            │             The JVM             │
                            │ class loading, JIT, GC, threads │
                            └─────────────────────────────────┘
```

## The Language Family

### Java: The Foundation

Java is the JVM's native language. It is strongly typed and conservative: new features go through public JEPs, and usually through several *preview* rounds, before becoming final.

**Java's philosophy**: readability over conciseness, backward compatibility above all. Code written for Java 1.0 still compiles today, with very few exceptions.

**Strengths**: massive ecosystem, multiple vendors, stability, hiring pool, a predictable release every six months (LTS every two years: 21, 25, then 29 in 2027).

**Where it's moving**: Java keeps absorbing ideas proven elsewhere (records, sealed types, pattern matching, virtual threads), each carefully fitted to Java's existing model. Recent releases also made small programs much less ceremonious:

```java
// Java 25: compact source file (JEP 512), no class declaration, java.base auto-imported
sealed interface Shape permits Circle, Square {}
record Circle(double radius) implements Shape {}
record Square(double side) implements Shape {}

double area(Shape shape) {
    return switch (shape) {
        case Circle(var r) -> Math.PI * r * r;
        case Square(var s) -> s * s;
    };
}

void main() {
    IO.println(area(new Circle(1.0)));
}
```

Run it directly with `java Shapes.java`, no compilation step needed.

### Scala: Pushing Boundaries

Scala combines object-oriented and functional programming with one of the most powerful type systems in mainstream use.

**Scala's philosophy**: express ideas precisely. The type system should help, not hinder. FP and OOP can coexist.

**Distinctive features** (not found in Java or Kotlin):
- Higher-kinded types
- Given instances and type classes (formerly implicits)
- Match types (compile-time type computation)
- Opaque types
- Metaprogramming with `inline` and quoted macros
- Named tuples (Scala 3.7+)
- An ecosystem of effect systems (Cats Effect, ZIO) and direct-style libraries (Ox)

**Where it's used**: data engineering (Spark), streaming (Kafka, Flink, Pekko), financial systems, distributed systems, functional programming.

<span class="since">Scala 3.9 LTS</span> The current state of the language, as of September 2026:

| Line          | Version                   | JDK      | Notes                                                                           |
| ------------- | ------------------------- | -------- | ------------------------------------------------------------------------------- |
| **Scala LTS** | 3.9 (released Sept 2026)  | 17+      | New long-term support line; recommended baseline for libraries                  |
| Previous LTS  | 3.3 (2023)                | 8+       | Maintained for one more year                                                    |
| Scala 3.8     | early 2026                | 17+      | Standard library compiled with Scala 3; lazy vals moved from `Unsafe` to `VarHandle` |
| Scala 2.13    | still maintained          | 8+       | For codebases not yet migrated                                                  |

Two JVM-related changes in 3.8 are worth knowing. First, the minimum JDK became **17**, which lets the compiler and library rely on modern JDK APIs. Second, `lazy val` initialization no longer uses `sun.misc.Unsafe`, whose memory-access methods now warn and will be removed (see [Chapter 23](23-module-system.md#unsafe-memory-access-java-24)). For older dependencies compiled with the previous encoding, the Scala team provides a tool (called Sloth) that rewrites their bytecode to the `VarHandle`-based version.

```scala
// Scala 3: type-safe, expressive, concise
enum Shape:
  case Circle(radius: Double)
  case Square(side: Double)

extension (s: Shape)
  def area: Double = s match
    case Shape.Circle(r) => math.Pi * r * r
    case Shape.Square(s) => s * s

// A type class instance
given Ordering[Shape] = Ordering.by(_.area)
```

### Kotlin: Pragmatic Java++

Kotlin was designed by JetBrains (the IntelliJ company) as a better Java, fixing Java's pain points while staying close to Java's model.

**Kotlin's philosophy**: pragmatic, concise, safe. 100% Java interop.

**Key features**:
- Null safety in the type system (`String` vs `String?`)
- Coroutines (suspending functions and structured concurrency, implemented by the compiler as state machines)
- Extension functions
- Data classes (records before Java had them)
- Smart casts
- Multiplatform (JVM, JS, Native, Wasm)

**Where it's used**: Android (the official language), server side (Spring, Ktor), multiplatform apps.

**Current state**: Kotlin 2.4 (June 2026) is the latest release; the **K2 compiler** has been the default since Kotlin 2.0, bringing much faster compilation and a unified front end for all platforms. Kotlin 2.5 is planned for December 2026.

```kotlin
// Kotlin
sealed interface Shape
data class Circle(val radius: Double) : Shape
data class Square(val side: Double) : Shape

fun Shape.area(): Double = when (this) {
    is Circle -> Math.PI * radius * radius
    is Square -> side * side
}
```

### Clojure: Lisp Reborn

Clojure is a modern Lisp on the JVM. It is dynamically typed, immutable by default, and centered on data transformation.

**Clojure's philosophy**: simplicity over familiarity. Data over objects. Immutability is the default.

**Key features**:
- Homoiconic (code is data, so macros are natural)
- Persistent data structures (efficient immutable collections using structural sharing)
- Software Transactional Memory (STM)
- REPL-driven development
- ClojureScript (compiles to JavaScript)

**Where it's used**: data processing, web backends, financial systems, data pipelines.

**Current state**: the Clojure 1.12 series (1.12.0 in 2024, patch releases through 2026) improved Java interop, including qualified method values like `String/.toUpperCase` and automatic conversion of Clojure functions to Java functional interfaces.

```clojure
;; Clojure
(defmulti area :type)
(defmethod area :circle [{:keys [radius]}]
  (* Math/PI radius radius))
(defmethod area :square [{:keys [side]}]
  (* side side))

(area {:type :circle :radius 5.0})  ;; 78.54
```

### Groovy: Scripting and DSLs

Groovy is a dynamic language with optional static typing. It is best known for Jenkins pipelines and Gradle build scripts (though new Gradle builds now default to the Kotlin DSL).

**Key features**: dynamic typing (or `@CompileStatic`), closures, operator overloading, builder-style DSLs, scripting. **Groovy 5.0** was released in 2025.

```groovy
// Groovy: closures and collection helpers
def shapes = [[type: 'circle', r: 1.0], [type: 'square', side: 2.0]]
def areas = shapes.collect { s ->
    s.type == 'circle' ? Math.PI * s.r * s.r : s.side * s.side
}
println areas.sum()
```

### And More

- **JRuby**: Ruby on the JVM. JRuby 10 (April 2025) targets Ruby 3.4 compatibility and requires Java 21, which lets it build on modern JVM features. It was one of the heaviest users of `invokedynamic`, which was designed with dynamic languages like it in mind.
- **GraalPy, GraalJS** and other Truffle languages: implemented as interpreters on top of GraalVM's Truffle framework (see [Chapter 20](../part-6-performance/20-graalvm.md)).
- **Jython** (Python 2 on the JVM), **Ceylon**, **Frege**, **Eta**: historical or niche today.

## How Languages Compile to Bytecode

All these languages target the same bytecode, but they do it differently:

| Language    | Compiler                    | Bytecode Style                                                   |
| ----------- | --------------------------- | ---------------------------------------------------------------- |
| **Java**    | `javac`                     | Clean, direct mapping; `invokedynamic` for lambdas and string concat |
| **Scala**   | `scalac` (Scala 3 compiler) | Richer: more generated classes, bridge methods, trait encodings, `VarHandle`-based lazy vals |
| **Kotlin**  | `kotlinc` (K2)              | Similar to Java, plus coroutine state machines                   |
| **Clojure** | Clojure compiler (at runtime or AOT) | Dynamic dispatch, lots of interface calls, vars for late binding |
| **Groovy**  | `groovyc`                   | `invokedynamic` for dynamic dispatch, metaclass protocol         |
| **JRuby**   | Interpreter + JIT to bytecode | Heavy use of `invokedynamic` for method call sites             |

### Cross-Language Interop

Because they all produce bytecode, these languages can call each other:

```scala
// Scala calling a Java library
import java.util.ArrayList
val list = new ArrayList[String]()
list.add("hello")

// Scala calling a Kotlin library
import com.example.KotlinUtils
KotlinUtils.process(data)
```

Interop is generally seamless for Java ↔ Scala and Java ↔ Kotlin. Scala ↔ Kotlin also works, but with more friction (different null handling, collection types), because both sides usually meet through Java-shaped APIs.

### The Interop Friction Points

| Issue                  | Description                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Null handling**      | Java allows null everywhere. Scala treats null as a code smell (or tracks it with `-Yexplicit-nulls`). Kotlin has `String?` vs `String`. |
| **Collections**        | Java uses `java.util.*`. Scala has its own `scala.collection.*`. Kotlin uses Java collections with read-only views. |
| **Default parameters** | Scala/Kotlin support them; Java doesn't (overloads needed at the boundary).                                    |
| **Companion objects**  | Scala's `object Foo` compiles to a `Foo$` class; Java sees static forwarders on `Foo`.                         |
| **Traits**             | Scala traits compile to interfaces with default methods. Some edge cases confuse Java callers.                 |
| **Implicits/Givens**   | Invisible to Java: you must pass them explicitly.                                                              |

### Scala-Java Interop Tips

```scala
// Make Scala code Java-friendly:

// 1. Use @BeanProperty for the JavaBeans convention
import scala.beans.BeanProperty
class Person(@BeanProperty var name: String)

// 2. Use Java collections at the API boundary
import scala.jdk.CollectionConverters.*
def getItems(): java.util.List[String] =
  scalaList.asJava

// 3. Offer plain factory methods in a companion object:
//    Java calls them through static forwarders, e.g. Person.create("Ada")
object Person:
  def create(name: String): Person = Person(name)
```

## How New JVM Features Benefit Each Language

The JVM's recent work is language-neutral, so the whole family benefits. Some features matter more to some languages than others:

| JVM feature                                        | Who benefits most, and why                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Virtual threads** (21), no `synchronized` pinning (24) | Scala direct-style libraries (Ox) and blocking code; Kotlin can run coroutines on a virtual-thread executor; any language with blocking JDBC/HTTP calls |
| **Compact object headers** (default in 27)         | Allocation-heavy styles: Scala and Clojure immutable collections, closures, `Option`s, tuples: 4 bytes less per object |
| **AOT cache / Leyden** (24 → 27)                   | Languages with many classes to load at startup: Scala and Clojure (Clojure's startup is dominated by loading its runtime), Kotlin server apps |
| **Value objects / Valhalla** (preview in 28)       | Scala `case class`es and opaque types, Kotlin `value class`es, small records: flattening without boxing       |
| **FFM API** (22)                                   | Everyone who wraps native libraries; replaces JNI in bindings                                                    |
| **Integrity by default** (17 → 26)                 | A cost first: languages and libraries that relied on `Unsafe` or deep reflection must migrate (Scala lazy vals did in 3.8) |

## Language Influence Map

```text
        ┌─────────────────────────────────────────────────────────┐
        │        ML, Haskell, Lisp, Erlang, Smalltalk, C#         │
        └────┬───────────────────────────┬───────────────────┬────┘
             ▼                           ▼                   ▼
        ┌─────────┐ concise syntax, ┌─────────┐         ┌─────────┐
   ╭───▶│  Scala  │────────────────▶│ Kotlin  │◀─╮      │ Clojure │◀───╮
   │    └────┬────┘  data classes   └────┬────┘  │      └────┬────┘    │
   │         │ (a)                       │ (b)   │           │ (c)     │
   │         ╰───────────────────────╮   │   ╭───┼───────────╯         │
   │                                 ▼   ▼   ▼   │                     │
   │                               ┌───────────┐ │                     │
   │                               │   Java    │ │                     │
   │                               └─────┬─────┘ │                     │
   │                                     │ (d)   │                     │
   │                                     ▼       │                     │
   │                          ┌──────────────────┴──┐                  │
   ╰──────────────────────────│    JVM platform     │──────────────────╯
                              │   (benefits all)    │
                              └─────────────────────┘

(a) FP ideas, pattern matching, case classes
(b) null-safety pressure, data classes
(c) immutability-first, persistent collections
(d) records, virtual threads, JVM features
```

The influence flows in every direction:
- **Scala (and the ML family) → Java**: lambdas and streams, records, sealed types, pattern matching, `var`
- **Scala → Kotlin**: data classes, concise syntax, extension-style APIs
- **Kotlin → Java**: pressure on null safety and conciseness (Valhalla's null-restricted types are being designed now)
- **Clojure → everyone**: immutability-first thinking, persistent data structures
- **Java → all**: ecosystem stability, library availability, virtual threads, and a platform that keeps improving

## Choosing a Language

| If you need...                             | Consider    |
| ------------------------------------------ | ----------- |
| Maximum hiring pool, enterprise stability  | **Java**    |
| Powerful type system, FP, data engineering | **Scala**   |
| Android, pragmatic Java improvement        | **Kotlin**  |
| Data-centric, REPL-driven, Lisp philosophy | **Clojure** |
| Scripting, Jenkins pipelines               | **Groovy**  |

The beauty of the JVM is that you don't have to choose just one. A team can write its core services in Scala, call Java libraries, and use Kotlin for its Android app, all on the same runtime.

<div class="takeaways">

## Key Takeaways

- The JVM hosts **many languages** because they all benefit from its GC, JIT, and library ecosystem
- **Java**: conservative, massive ecosystem, steadily adopting ideas from Scala and Kotlin; Java 25 made small programs lightweight
- **Scala**: most powerful type system, FP + OOP; **Scala 3.9 LTS** (Sept 2026) requires JDK 17+ and no longer depends on `sun.misc.Unsafe` for lazy vals
- **Kotlin**: pragmatic Java++, null safety, coroutines; K2 compiler by default, 2.4 current
- **Clojure**, **Groovy**, **JRuby**: dynamic languages that lean on `invokedynamic` and the JIT
- Cross-language **interop** works because they share bytecode, but friction exists (nulls, collections, naming)
- Platform features (virtual threads, compact headers, AOT cache, value objects) benefit **every** JVM language

</div>
