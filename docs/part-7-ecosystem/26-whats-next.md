# Chapter 26 — What's Next for the JVM

## The Active Projects

The JVM is under active, ambitious development. A handful of long-running OpenJDK projects are reshaping the platform, and each ships its work in small steps through JEPs, one six-month release at a time. This chapter describes where each project stands as of **September 2026** (JDK 27 just released, JDK 28 due in March 2027) and where it's headed.

<p class="timeline-title">Big-project milestones, JDK 21 to 28</p>
<ol class="timeline">
<li><span class="when">JDK 21 (LTS, 2023)</span>Virtual threads final</li>
<li><span class="when">JDK 22 (2024)</span>FFM API final<br/>Unnamed variables and patterns</li>
<li><span class="when">JDK 24 (2025)</span>AOT class loading and linking (Leyden)<br/>Compact object headers, experimental (Lilliput)<br/>synchronized no longer pins virtual threads</li>
<li><span class="when">JDK 25 (LTS, 2025)</span>Scoped values final<br/>AOT method profiling<br/>Compact headers become a product feature</li>
<li><span class="when">JDK 26 (2026)</span>AOT cache works with any GC<br/>Final-field mutation warnings</li>
<li><span class="when">JDK 27 (2026)</span>Compact headers on by default<br/>G1 default everywhere</li>
<li class="future"><span class="when">JDK 28 (2027)</span>Value objects preview (Valhalla)<br/>AOT code compilation proposed</li>
</ol>

## Project Valhalla — Value Objects <span class="preview">Preview in 28</span>

**Goal**: let developers define types that "code like a class, work like an int": no identity, so the JVM is free to store them flat, without headers or pointers.

**What it solves**:
- The per-object header overhead and pointer chasing (see [Chapter 8](../part-3-memory-and-gc/08-object-layout.md))
- Boxing of primitives in generics (`List<Integer>` holds pointers to `Integer` objects)
- Poor cache locality for arrays of small objects

**Status**: after a decade of research, the first big piece has landed. **JEP 401, Value Objects**, is integrated into JDK 28 as a preview feature (GA in March 2027, `--enable-preview` required):

```java
value record Point(int x, int y) {}

var a = new Point(1, 2);
var b = new Point(1, 2);
IO.println(a == b);                  // true: compared by class and field values
IO.println(Objects.hasIdentity(a));  // false
Object o = a;
synchronized (o) { }                 // throws IdentityException (on "a" directly: compile error)
```

With preview enabled, about thirty JDK classes become value classes too, including `Integer`, `Long`, `Double`, `Optional` and the `java.time` types such as `LocalDate`. So `Integer x = 1996, y = 1996; x == y` finally returns `true`.

**What's still to come**:
- **Null-restricted types** (draft JEPs): a way to say "this `Point` is never null", which lets the JVM flatten fields and arrays completely.
- **Generic specialization**: `List<int>`-style generics without boxing. Further out.
- Valhalla is also what the **Vector API** is waiting for before it can leave incubation.

**Impact on Scala**: this is the big one. Value references can still be `null` under JEP 401, so a Scala `case class` can't simply become a value class without thought, but `AnyVal` wrappers, opaque types, small immutable case classes and tuples are natural candidates for a future Scala encoding. Deeper dive: [Chapter 14](../part-4-type-system/14-value-types-valhalla.md).

## Project Loom — Lightweight Concurrency

**Goal**: lightweight threads and a structured way to use them.

**Status**: mostly done.

| Feature                                       | Status                                       |
| --------------------------------------------- | -------------------------------------------- |
| Virtual threads                               | Final in Java 21                             |
| `synchronized` without pinning (JEP 491)      | Java 24                                      |
| Scoped values (`ScopedValue`, JEP 506)        | Final in Java 25                             |
| Structured concurrency (`StructuredTaskScope`) | <span class="preview">Preview in 27</span> (7th round) |

Structured concurrency got a redesigned API in Java 25: you open a scope with `StructuredTaskScope.open()` and choose a policy with a `Joiner` instead of subclassing:

```java
Response handle() throws ExecutionException, InterruptedException {
    try (var scope = StructuredTaskScope.open()) {
        Subtask<String> user = scope.fork(() -> findUser());
        Subtask<Integer> order = scope.fork(() -> fetchOrder());
        scope.join();            // fails fast if either subtask fails
        return new Response(user.get(), order.get());
    }
}
```

**Impact on Scala**: virtual threads complement rather than replace Cats Effect and ZIO. Effect systems still offer stronger compositional guarantees (cancellation, resource safety, typed errors), but virtual threads make plain blocking code scale, and they are the foundation of direct-style Scala libraries such as Ox. See [Chapter 18](../part-5-concurrency/18-virtual-threads.md).

## Project Panama — Native Interop and SIMD

**Goal**: replace JNI with safe, efficient native interop, and give Java access to SIMD instructions.

**Status**:
- **Foreign Function & Memory API**: final since Java 22. `jextract` generates bindings from C headers.
- **Vector API**: still incubating (12th round in JDK 27), waiting for Valhalla so that vectors can become value objects.

```java
// Vector API: multiply-add, as many lanes at a time as the CPU supports
var species = IntVector.SPECIES_PREFERRED;
var va = IntVector.fromArray(species, a, 0);
var vb = IntVector.fromArray(species, b, 0);
va.mul(vb).add(va).intoArray(c, 0);
```

**Impact on Scala**: direct C interop without JNI, from plain Scala code. The Vector API will help numerical Scala code once it's final. See [Chapter 24](24-native-interop.md).

## Project Leyden — Faster Startup and Warmup

**Goal**: shift work that the JVM repeats on every launch (loading, linking, profiling, compiling) to a **training run**, and reuse the result from an **AOT cache**.

**Status**: shipping, one layer at a time:

```text
┌──────────────────────────┐
│ CDS / AppCDS             │
│ class metadata archive   │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│ JDK 24                   │
│ classes loaded + linked  │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│ JDK 25                   │
│ + method profiles        │
│ one-step training        │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│ JDK 26                   │
│ works with any GC,       │
│ incl. ZGC                │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│ JDK 28 (proposed)        │
│ + AOT-compiled code      │
└──────────────────────────┘
```

```bash
# JDK 25+: one training run, then production runs
java -XX:AOTCacheOutput=app.aot -jar app.jar   # training run (exercise the app, then exit)
java -XX:AOTCache=app.aot -jar app.jar          # production: faster startup and warmup
```

The next step, **JEP 544 Ahead-of-Time Code Compilation**, is proposed to target JDK 28: native code compiled during training is stored in the cache, while the JIT remains free to recompile hot methods. The JEP reports framework startup improvements of 50–70% with the AOT cache alone and 65–80% with AOT code. The training and production runs must use the same JDK, the same CPU features and the same GC.

**Leyden vs GraalVM Native Image**: Leyden keeps the full, dynamic JVM (reflection, class loading, the JIT) and gets a large part of the startup benefit. Native Image remains the choice for the smallest and fastest-starting closed-world binaries. Oracle has meanwhile refocused GraalVM on its non-Java languages, which makes Leyden the mainstream OpenJDK path (see [Chapter 20](../part-6-performance/20-graalvm.md)).

**Impact on Scala**: Scala applications load a lot of classes (the standard library, your dependencies, generated classes for lambdas and case classes), so they are exactly the kind of workload that benefits, with no code changes and no closed-world restrictions.

## Project Lilliput — Smaller Object Headers

**Goal**: shrink the object header, which every object pays for.

**Status**: step one is **done**. Compact object headers went from experimental (JDK 24, JEP 450) to a product feature (JDK 25, JEP 519) to **on by default in JDK 27** (JEP 534):

```text
Legacy:   mark word (8 bytes) + compressed class pointer (4 bytes) = 12 bytes
Compact:  one 64-bit word = mark bits + class index              =  8 bytes
```

Saving 4 bytes per object sounds small, but it adds up: on SPECjbb2015 the JEP reports 22% less heap, 8% less CPU and 15% fewer GCs. You can switch back with `-XX:-UseCompactObjectHeaders`, although the old layout is expected to be deprecated eventually.

**Next**: a draft JEP proposes **4-byte object headers** as an experimental option. See [Chapter 8](../part-3-memory-and-gc/08-object-layout.md) for the bit layouts.

## Project Babylon — Code Reflection

**Goal**: let Java programs access the *code* of a method or lambda as data (not just its signature, as today's reflection does), so that libraries can analyze and translate it.

**Status**: research project; a **Code Reflection (Incubator)** JEP has been submitted but is not in any release yet.

**Think of it as**: something between C#'s LINQ expression trees and Scala's quoted code, provided by the platform.

**Use cases**:
- GPU programming (translate Java code to GPU kernels)
- Database queries (translate Java lambdas to SQL)
- Automatic differentiation (for machine learning)
- Translating Java code to ONNX models and other accelerator formats

**Impact on Scala**: Scala 3 already has `inline`, `scala.compiletime` and quoted macros for compile-time metaprogramming. Babylon works at *runtime* on Java's own code model, so its direct impact on Scala is uncertain, but it may give GPU and ML libraries a common target.

## Project Amber and the Core Libraries

Amber is where Java's language features come from, delivered in small steps. Alongside it, the core-libraries team keeps adding APIs through the same preview/incubator process:

| Feature                                                  | Status                                        |
| -------------------------------------------------------- | --------------------------------------------- |
| Records, sealed types, switch patterns, record patterns  | Final (16–21)                                 |
| Unnamed variables and patterns (`_`)                     | Final in 22                                   |
| Module imports, compact source files, flexible constructor bodies | Final in 25                          |
| Primitive types in patterns, `instanceof` and `switch`   | <span class="preview">Preview in 27</span> (5th round) |
| Lazy constants (`LazyConstant`, formerly stable values)  | <span class="preview">Preview in 27</span> (3rd round) |
| Simple JSON API                                          | <span class="preview">Incubator in 28</span>  |
| String templates                                         | Withdrawn after JDK 22; may return in another form |

## Integrity by Default

Not a project but a clear direction across releases: the JVM should be able to trust that `private` means private and `final` means final, and native code should only run when the application owner opts in. Deep reflection into JDK internals has been blocked since 17; the Security Manager was disabled in 24; JNI/FFM native access and `sun.misc.Unsafe` memory access print warnings since 24; mutating `final` fields reflectively warns since 26. Each warning is scheduled to become an error. Details and flags: [Chapter 23](23-module-system.md#integrity-by-default).

## The Bigger Trend

```text
┌────────────────────────────────────────────────────┐
│ 1995–2010                                          │
│ The JVM provides the basics: GC, JIT, threads      │
│ Languages adapt to its constraints                 │
└──────────────────────────┬─────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────┐
│ 2010–2020                                          │
│ Languages push boundaries, the JVM adapts          │
│ invokedynamic, lambdas, default methods, modules   │
└──────────────────────────┬─────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────┐
│ 2020–2030                                          │
│ The JVM evolves for all languages                  │
│ virtual threads, native interop, AOT caches,       │
│ compact headers, value objects                     │
└────────────────────────────────────────────────────┘
```

The JVM is becoming a more **universal platform**: not just "Java's runtime" but a runtime whose improvements (smaller objects, faster startup, cheap threads, flat value objects) benefit Scala, Kotlin and every other JVM language automatically.

## What This Means for Your Scala Code

| Project      | Status (Sept 2026)                                    | What changes for you                                                        |
| ------------ | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| **Lilliput** | Compact headers **on by default** in JDK 27           | Every object 4 bytes smaller: less heap, fewer GCs, for free                |
| **Leyden**   | AOT cache since JDK 24; AOT code proposed for 28      | Add a training run to your build to start and warm up faster                |
| **Loom**     | Virtual threads, scoped values final; SC in preview   | Blocking code scales; direct-style libraries; CE/ZIO can use virtual threads |
| **Panama**   | FFM final (22); Vector API incubating                 | C interop without JNI; remember `--enable-native-access`                    |
| **Valhalla** | Value objects **preview in JDK 28**                   | Try `value record` today in Java; watch for a Scala encoding of value classes |
| **Integrity**| Warnings for native access, `Unsafe`, final fields    | Upgrade to Scala 3.8+/3.9 LTS and recent libraries; add opt-in flags only where needed |
| **Babylon**  | Incubator JEP submitted                               | New possibilities for GPU/ML libraries; nothing to do yet                   |

The JVM is not standing still. It's evolving faster than at any point in its 30-year history, and Scala is positioned to benefit from every advancement.

<div class="takeaways">

## Key Takeaways

- **Valhalla**: JEP 401 value objects arrive as a preview in JDK 28; null-restricted types and specialized generics come later
- **Leyden**: the AOT cache ships today (JDK 24–26); AOT-compiled code is proposed for JDK 28
- **Lilliput**: compact 8-byte headers are the default in JDK 27; 4-byte headers are next
- **Loom**: virtual threads and scoped values are final; structured concurrency is still in preview
- **Panama**: the FFM API is final; the Vector API waits for Valhalla
- **Babylon**: code reflection is heading for its first incubator release
- **Amber** keeps delivering language features; **integrity by default** turns unsafe practices into explicit opt-ins
- The JVM is evolving from "Java's runtime" into a **universal platform** for all JVM languages

</div>
