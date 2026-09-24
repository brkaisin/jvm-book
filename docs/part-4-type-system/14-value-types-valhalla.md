# Chapter 14 — Value Objects and Project Valhalla

## The Problem: Everything Is a Pointer

We saw in [Chapter 8](../part-3-memory-and-gc/08-object-layout.md) that every object on the JVM has a header and is accessed through a reference (a pointer). For large objects, this overhead is negligible. But for small value-like things — coordinates, colors, money amounts, dates — the overhead dominates.

Consider a `Point` with two `int` fields:

```text
                     compact headers        legacy headers
                     (default, JDK 27+)     (-XX:-UseCompactObjectHeaders)
Actual data          8 bytes                8 bytes
Object header        8 bytes               12 bytes
Alignment padding    0 bytes                4 bytes
Total per object    16 bytes (2x data)     24 bytes (3x data)
+ the reference      4 bytes                4 bytes
```

Compact object headers (on by default since JDK 27) halved the tax, but it's still there. And when you store these in an array, the real cost shows up (Figure 14.1):

<figure class="fig">
{{#include ../figures/14-flattened-points.svg}}
<figcaption><b>Figure 14.1.</b> Today a <code>Point[]</code> holds references to separate objects scattered on the heap (60 bytes for three points, array header not counted); what we'd like is the fields stored inline and contiguously (24 bytes).</figcaption>
</figure>

The pointer-based layout has three costs:

1. **Memory waste**: headers and references eat space
2. **Cache misses**: objects can end up scattered on the heap, so iterating means one potential cache miss per element
3. **GC overhead**: more objects means more work for the garbage collector

## Today's Workarounds

### Java: primitive types only

Java's primitives (`int`, `long`, `double`, …) avoid these costs — they're stored inline, with no headers. But you can't define your own primitives. And as soon as you use generics, they get boxed.

### Scala: `AnyVal`

```scala
case class UserId(value: Long) extends AnyVal
```

Scala's `AnyVal` tells the compiler: "This is just a wrapper. Erase it at runtime." In many cases, `UserId(42L)` compiles to just the `long` value `42L`, with no object.

But `AnyVal` has limitations:

- Boxing occurs in generic contexts: a `List[UserId]` holds real `UserId` objects
- Boxing occurs when the value is used through a trait type, or pattern matched
- Exactly one field
- Arrays of them hold boxed objects

```scala
val id: UserId = UserId(42L)       // No object — just a long
val ids: List[UserId] = List(id)   // Boxed! List stores objects, not primitives
```

### Scala 3: `opaque type`

```scala
object UserId:
  opaque type UserId = Long
  def apply(value: Long): UserId = value
  extension (id: UserId) def value: Long = id
```

Opaque types are erased at compile time — `UserId` *is* `Long` at the bytecode level. Unlike `AnyVal`:

- No wrapper class exists at all
- The compiler never generates a `UserId` class
- But in generic contexts, boxing to `java.lang.Long` still happens, because that's what `Long` does

Both `AnyVal` and `opaque type` are **compile-time tricks** that the JVM knows nothing about. They can't solve the underlying problem: the JVM has no user-defined types that can live without a pointer.

## Identity: The Real Culprit

Why can't the JVM just store `Point`s inline? Because every Java object has **identity**. Two `new Point(1, 2)` calls produce two objects that `==` can tell apart, that you can `synchronized` on separately, that have their own `System.identityHashCode`, and that can be mutated independently. The simplest way for the JVM to honour all that is to give each object its own address — a pointer.

For mutable objects, identity is essential. For immutable data like a date or a point, it's pure overhead — and a source of bugs:

```java
Integer i = 100, j = 100;
i == j;   // true  (small values come from Integer's cache)

Integer x = 1996, y = 1996;
x == y;   // false (two different boxes with the same value)
```

**Project Valhalla** has been working on this since 2014. Its motto: *codes like a class, works like an `int`*. The key insight that came out of years of prototypes is that the JVM doesn't need a new kind of type. It needs a way for a class to say: **"my instances don't need identity."** Everything else — flattening, fewer allocations, less GC — the JVM can then do on its own.

<p class="timeline-title">Project Valhalla, in brief</p>
<ol class="timeline">
<li><span class="when">2014</span>Project starts</li>
<li><span class="when">2015 - 2022</span>Prototypes and redesigns<br/>value types, inline classes, primitive classes</li>
<li><span class="when">2020</span>JEP 401 created</li>
<li><span class="when">2026</span>JEP 401 and JEP 539 integrated into JDK 28</li>
<li class="future"><span class="when">Mar 2027</span>JDK 28 GA with value objects as a preview feature</li>
<li class="future"><span class="when">Later</span>null-restricted types<br/>generics over primitives and value classes</li>
</ol>

## Value Objects <span class="preview">Preview in JDK 28</span>

**JEP 401, Value Objects (Preview)** is integrated into JDK 28 (GA March 2027; early-access builds are available now). It adds one modifier: `value`.

> [!IMPORTANT]
> This is a **preview** language and VM feature. Compile with `javac --release 28 --enable-preview`, and run with `java --enable-preview` (the same flag works for the source launcher, `java --enable-preview Main.java`, and for `jshell --enable-preview`). Details may still change before it becomes final.

### Declaring value classes

```java
value record Point(int x, int y) {}

void main() {
    var a = new Point(1, 2);
    var b = new Point(1, 2);

    IO.println(a == b);                   // true: same class, same field values
    IO.println(Objects.hasIdentity(a));   // false
}
```

A **value class** is a class whose instances — **value objects** — have no identity. Everything else is a normal **identity class**, and `Objects.hasIdentity(o)` tells you which kind an object is. The rules follow from "no identity":

- All instance fields are implicitly `final`.
- The class is implicitly `final` (unless declared `abstract`, see below).
- Fields can have any type: primitives, other value objects, or identity objects like `String`.
- It can implement interfaces, and it can be used anywhere an `Object` is expected — in `List<Point>`, `Map<Point, String>`, `Object[]`.
- Its references can still be `null`. A value object is still an object; excluding `null` is a separate, future feature (see [What's Next](#whats-next-drafts-not-final)).

Records are natural candidates, which is why `value record` exists. But a value class doesn't have to be a record — its internal fields can differ from its API:

```java
value class Money {
    private long cents;          // implicitly final
    private String currency;     // an identity object inside a value object: fine

    Money(long cents, String currency) {
        this.cents = cents;
        this.currency = Objects.requireNonNull(currency);
    }

    Money plus(Money other) {
        if (!currency.equals(other.currency)) throw new IllegalArgumentException();
        return new Money(cents + other.cents, currency);
    }

    @Override public boolean equals(Object o) {
        return o instanceof Money m && cents == m.cents && currency.equals(m.currency);
    }
    @Override public int hashCode() { return Objects.hash(cents, currency); }
    @Override public String toString() { return "%d.%02d %s".formatted(cents / 100, cents % 100, currency); }
}
```

Why override `equals` here? Read on.

### What `==` means now

For identity objects, `==` still means "same object" — exactly as in Java 1.0. For value objects, `==` asks: **are these two indistinguishable?** Two value objects are `==` when:

1. they are instances of the **same value class**,
2. their primitive fields hold the **same bit patterns**, and
3. their reference fields are `==`, applied **recursively**.

`==` and `equals` usually agree, but not always:

- **Identity objects inside.** Two `Money` objects whose `currency` fields are equal but *distinct* `String` objects are not `==` (step 3 compares the strings by identity). The inherited `Object.equals` uses `==`, which is why `Money` overrides it.
- **Floating-point NaN.** There are many NaN bit patterns. A `value record Length(float val)` wrapping two different NaNs is not `==`, but the record's generated `equals` treats them as equal.
- **Representation vs. value.** A value class may store the same logical value in different ways (say, a substring as source string plus offsets), so `equals` is the right question to ask about *values*.

> [!TIP]
> The advice doesn't change: compare objects with `equals`. What changes is that `==` on value objects stops giving *surprising* answers, like `1996 != 1996` for boxed integers.

Because `==` recurses through fields, comparing two deep nests of value objects can take a while (or even overflow the stack). Constructors are restricted so that value objects can never form a cycle, so it always terminates.

### What you can't do with a value object

"No identity" means that identity-sensitive operations either don't compile or fail at runtime:

| Operation                                   | With a value object                                          |
| ------------------------------------------- | ------------------------------------------------------------ |
| `synchronized (v) { … }`                    | Compile error; via an `Object` reference: `IdentityException` |
| `v.wait()`, `v.notify()`                    | Always `IllegalMonitorStateException` (you can't hold the lock) |
| `new WeakReference<>(v)`, `WeakHashMap` key | `IdentityException`                                          |
| `System.identityHashCode(v)`                | Works, but computed from the field values                    |
| `finalize()`                                | Never called by the GC                                       |
| Mutating a field via deep reflection        | Not allowed, even with `--enable-final-field-mutation`       |
| Java serialization (non-record)             | Needs `writeReplace`/`readResolve`; value records just work   |
| Extending a concrete value class            | Not allowed: it's implicitly `final`                         |

```java
Object o = LocalDate.of(1996, 1, 23);    // a value object, with preview enabled
synchronized (o) { }                     // java.lang.IdentityException:
                                         // Cannot synchronize on an instance of value class java.time.LocalDate
```

`java.util.Objects.requireIdentity(o)` throws if you're handed a value object where your code relies on identity — handy for libraries that lock on user objects or keep weak caches.

### Hierarchies: abstract value classes

A value class can extend only `Object` or an **abstract value class**. An abstract value class says "I don't need identity"; its subclasses can be value classes *or* identity classes. `java.lang.Number` becomes one, so `Integer` (value) and `BigInteger` (identity) can both extend it.

```java
sealed abstract value class UserId permits EmailId, PhoneId {}

value class EmailId extends UserId { private String name, domain; /* ... */ }
value class PhoneId extends UserId { private String digits;      /* ... */ }
```

There is no `java.lang.Value` superclass. `Object` stays the root of everything.

### Constructors: everything happens before `super()`

A value object must never be seen half-built — with no identity, there's no "the same object, later" to observe changing. So value class constructors always run in the **early construction phase** that Java 25's flexible constructor bodies introduced: the compiler puts the implicit `super()` call at the **end** of the constructor, not the beginning. Until then you can assign fields, but you can't use `this`:

```java
value class Name {
    String name;
    int length;

    Name(String n) {
        name = n;
        length = n.length();       // OK
        // length = computeLength(); // Error: calls an instance method before super()
        // super() is implicitly here, after all fields are set
    }
}
```

If you really need `this` (to log it, say), write an explicit `super();` after assigning every field, and the code after it runs as usual.

With preview enabled, **all records** — value or identity — adopt the same rules, and early-phase code in any class may now *read* the fields it has already assigned. That's a small source incompatibility for the rare record constructor that leaks `this`.

### The JDK's own value classes

With preview enabled, 30 JDK classes become value classes. They were all documented as *value-based* for years precisely to prepare for this moment, and since Java 16 `javac` has warned if you synchronize on them.

| Package            | Value classes (with `--enable-preview`)                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `java.lang`        | `Integer`, `Long`, `Float`, `Double`, `Byte`, `Short`, `Character`, `Boolean`, `Number`\*, `Record`\*    |
| `java.util`        | `Optional`, `OptionalInt`, `OptionalLong`, `OptionalDouble`                                             |
| `java.time`        | `LocalDate`, `LocalTime`, `LocalDateTime`, `ZonedDateTime`, `OffsetTime`, `OffsetDateTime`, `Duration`, `Instant`, `Period`, `Year`, `YearMonth`, `MonthDay` |
| `java.time.chrono` | `MinguoDate`, `HijrahDate`, `JapaneseDate`, `ThaiBuddhistDate`                                           |

\* abstract value classes

```java
// jshell --enable-preview
Integer x = 1996, y = 1996;
x == y                                // true (false without preview)

LocalDate d1 = LocalDate.of(1996, 1, 23);
d1 == d1.plusYears(30).minusYears(30) // true

Objects.hasIdentity("abcd")           // true: String stays an identity class
```

The switch is all-or-nothing per JVM: with preview enabled, you get the value-class `LocalDate`, and there's no way to ask for the old identity version.

`String` is *not* on the list — too much of its API and implementation depends on identity.

In the class file, the difference is a flag: identity classes carry `ACC_IDENTITY`, which reuses the bit of the old `ACC_SUPER` flag that compilers have always set. So every existing class file, from any JVM language, is an identity class. Reflection sees it as `AccessFlag.IDENTITY`.

## How the JVM Uses the Freedom

Here's the subtle part: JEP 401 gives you **semantics**, not a memory layout. Because nobody can tell two equal value objects apart, the JVM may copy them, re-encode them, or never allocate them at all. Two techniques matter.

**Reference scalarization** — in JIT-compiled code, a local variable or method parameter of a value class type can be broken into its fields, held in registers, and passed and returned field by field. No heap object exists.

```java
Point p = new Point(1, 2);
Point q = new Point(p.x() + 3, p.y() + 4);
// with scalarization: just four ints in registers (plus null flags), no allocation
```

Escape analysis could already do this for identity objects, but only when it could prove that the object never escapes; for value objects it works reliably, even across (non-inlined) method calls.

**Reference flattening** — a field or array element holds the value object's fields directly, plus a **null flag** (the reference can still be `null`), instead of a pointer. JEP 401 uses `LocalDate` as its example: year, month, and day are an `int` and two `byte`s, so a flag plus the data fits in a 64-bit word (Figure 14.2; compare with the pointer layout of Figure 14.1):

<figure class="fig">
{{#include ../figures/14-flattened-localdate.svg}}
<figcaption><b>Figure 14.2.</b> A flattened <code>LocalDate[]</code>: each element is one 64-bit word holding a null flag and the fields, and a <code>null</code> element is just a word whose flag is 0.</figcaption>
</figure>

### The caveats: when is a reference flattened?

Flattening is an optimization, not a language feature: you can't request it, and the JVM decides silently. What it can do depends on a few things:

```text
A variable holding a value object
│
└── Declared type is exactly the value class?
    │
    ├── No: Object, an interface, or an erased generic T
    │       ──▶ heap object + pointer
    │
    └── Yes: where does it live?
        │
        ├── Local variable or parameter, in JIT-compiled code
        │       ──▶ scalarized into registers
        │
        ├── Field of a value object
        │       ──▶ can be flattened at any size
        │
        └── Array element, or field of an identity object:
            do fields + null flag fit in an atomic 64-bit word?
            ├── Yes ──▶ can be flattened
            └── No  ──▶ heap object + pointer
```

- **Declared type.** `Integer[]` can be flattened; `Object[]` holding the same `Integer`s can't. A field of generic type `T` erases to `Object`, so `record Box<T>(T value)` stores a pointer even for `Box<Integer>` — the value object is boxed into a heap object on the way in. (It's still a value object: `==` and `hasIdentity` behave the same. Only the encoding differs.)
- **Size and atomicity.** Array elements and fields of identity objects are *mutable* locations. A flattened reference must be read and written atomically, or a racing thread could see half of one value and half of another. On common hardware, that caps these locations at **64 bits including the null flag**. Fields *inside* a value object have no such limit, because they can never change.
- **Nullability.** That null flag costs at least a bit, and often pushes a value over a size boundary.

Put together, some honest consequences for JDK 28:

- `value record Point(int x, int y)` is 64 bits of data. Add a null flag and it's 65 — **too big to flatten into a `Point[]`**. You still get scalarization in hot code, `==` semantics, and flattening inside other value objects (a `value record Segment(Point from, Point to)` can hold both points inline).
- A flattened `Integer[]` probably uses a 64-bit word per element: twice an `int[]`, but far less than pointers to boxes, and no pointer chasing.
- `LocalDateTime` (a date, a time, and three null flags) is too large for a mutable field, but it can be flattened into a field of a value class like `value record Event(LocalDateTime timestamp, ...)`.

> [!WARNING]
> Classes compiled against a class *before* it became a value class don't know it's a value class early enough to flatten it: the compiler records the value classes a class file uses in a new `LoadableDescriptors` attribute. After a library migrates classes to `value`, **recompile** code that depends on it to get the full benefit. And during warmup, before the JIT has kicked in, the JVM may even allocate *more* often (for example on each read of a flattened field in interpreted code).

To make the memory side tangible, here is the arithmetic for 10 million integers (compressed references, distinct values beyond the `Integer` cache):

| Storage                                   | Per element                 | Total    |
| ----------------------------------------- | --------------------------- | -------- |
| `int[]`                                   | 4 bytes                     | ~40 MB   |
| `Integer[]` today (pointers to boxes)     | 4-byte ref + 16-byte object | ~200 MB  |
| `Integer[]`, flattened (value objects)    | likely one 64-bit word      | ~80 MB   |
| `List<Integer>` / Scala `List[Int]`       | pointers, erased to `Object` | not flattenable |

How that translates into time depends on access patterns and the JIT; measure your own workload with JMH rather than trusting rules of thumb.

## Strict Field Initialization <span class="preview">Preview in JDK 28</span>

Value objects need a guarantee the JVM never gave before: that a `final` field is **never observed with two different values**. Today, a field starts life as `0`/`null`, and a sufficiently tangled constructor or static initializer can read that default before the "real" value arrives:

```java
class App {
    static final long appID = Log.currentPID();   // triggers Log's initialization...
}

class Log {
    static final String prefix = "App[" + App.appID + "]: ";   // ...which reads appID = 0!
    static long currentPID() { return ProcessHandle.current().pid(); }
}
```

**JEP 539, Strict Field Initialization in the JVM (Preview)**, also in JDK 28, adds a class-file flag, `ACC_STRICT_INIT`, for **strictly-initialized fields**:

- an instance field must be assigned **before** the `super()` call, can't be read before it, and if it's `final`, can't be changed after — checked by the bytecode **verifier**;
- a static field can't be read before it's assigned during class initialization, and must be assigned before initialization completes — checked at **runtime** with an exception.

The payoff: default values are never observed, and the JIT can treat strictly-initialized `final` fields as truly constant ("trusted"), which it historically couldn't do for ordinary `final` instance fields. It belongs to the same "integrity by default" trend as JEP 500 in JDK 26, which started warning about reflective mutation of `final` fields.

This is a **VM** feature, not a language one: there is no `strict` keyword in Java. `javac` marks every field of a value class as strict, and other compilers — Scala's, Kotlin's — are free to use it for their own features. Like other preview VM features, it only works in preview class files (version 72.65535) on a JVM started with `--enable-preview`.

## What's Next (drafts, not final)

> [!CAUTION]
> Everything in this section is from **draft** JEPs that are not targeted to any release. Syntax and semantics can and do change; treat the code as illustrative.

The limits above — null flags and atomicity — are exactly what the next steps attack.

```text
         ┌──────────────────────────────────────────────────┐
         │ JEP 401 Value Objects                            │
         │ + JEP 539 Strict Fields                          │
         │ (preview, JDK 28)                                │
         └┬───────────────────────┬───────────────────────┬─┘
          ▼                       ▼                       ▼
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│ Null-Restricted   │   │ Null-Restricted   │   │ JEP 402 Enhanced  │
│ Value Class Types │   │ and Nullable      │   │ Primitive Boxing  │
│ (draft)           │   │ Types (draft)     │   │ (draft)           │
└─────────┬─────────┘   └───────────────────┘   └─────────┬─────────┘
          │                                               │
          └───────────────────────┬───────────────────────┘
                                  ▼
                   ┌──────────────────────────────┐
                   │ JEP 218 Generics over        │
                   │ Primitive Types              │
                   │ (specialized generics,       │
                   │ far future)                  │
                   └──────────────────────────────┘
```

**Null-restricted value class types** (draft). A type like `Point!` would exclude `null`, so no null flag is needed:

```java
// DRAFT SYNTAX — not in any JDK release
value record Range(int start, int end) {
    public implicit Range();           // opt in to an all-zero default instance
}

Range![] ranges = new Range![1000];    // elements default to Range[start=0, end=0]
```

A null-restricted array needs *something* in its slots before you write to them, so the class must opt in to a **default "zero instance"** (all fields zero) with an `implicit` constructor. Large classes could further opt in to **non-atomic** updates (the draft uses a `LooselyConsistentValue` interface) — accepting that a data race could tear a value, exactly like `long` and `double` fields are allowed to. With both, a `Point![]` could finally be the flat `x, y, x, y, …` block from the start of this chapter.

**Null-restricted and nullable types** (draft) generalizes the idea to all reference types: `String!` rejects `null`, `String?` deliberately allows it, and plain `String` means "unspecified", as today.

**Generic specialization** is the far horizon. JEP 402 (draft) would let primitive types appear as type arguments, implemented via boxing — which becomes cheap once boxes are value objects. JEP 218 (Generics over Primitive Types, a candidate JEP) aims further: generic classes whose layouts are *specialized* for `int` or `Point`, so that a `List<int>` or `ArrayList<Point!>` stores its elements flat. That's the end of the boxing story, and it's years away.

Meanwhile the **Vector API** keeps incubating (12th incubator in JDK 27) precisely because it wants to be rebuilt on value classes, and compact object headers (default in JDK 27) already reserve 4 header bits for Valhalla.

> [!NOTE]
> **A glossary of dead names.** Valhalla went through many designs, and older talks and blog posts use terms that no longer exist: *value types*, *minimal value types*, *inline classes*, *primitive classes*, `Point.ref` / `Point.val` projections, `__ByValue` class modifiers, and `Q`-type descriptors (`QPoint;`) in class files. None of these are part of JEP 401. Today there are just **identity classes** and **value classes**, both used through ordinary references.

## What Valhalla Means for Scala

First, a naming collision: Scala has had "value classes" since 2.10 — that's `extends AnyVal`, a compile-time erasure trick. JVM value classes are a runtime concept. They are different things that happen to share a name.

**What you get for free, with `--enable-preview` on JDK 28.** Scala code runs on the same JDK classes as Java:

- Boxed `Int`s are `java.lang.Integer` objects, so they become value objects too. Scala's `eq` compiles to the same reference-comparison bytecode as Java's `==`, so `(1996: Integer) eq (1996: Integer)` becomes `true`.
- `synchronized` on a boxed number, a `LocalDate`, or a `java.util.Optional` now throws `IdentityException`.
- Generic Scala collections store elements as `Object`, so a `List[Int]` or `Vector[LocalDate]` still holds pointers. Don't expect a big memory change there until specialized generics arrive.

**Your own Scala classes stay identity classes.** `scalac` sets `ACC_SUPER` like every compiler always has, which now means `ACC_IDENTITY`. Scala has **not** announced how it will expose JVM value classes, and there's no committed encoding yet. But it's easy to see where the fit is natural:

- A `final case class` with only `val`s is immutable and compared structurally — exactly what `value record` is for. The catch: `eq` on such a class would change meaning, and so would `synchronized`, weak references, and anything else identity-based.
- `AnyVal` wrappers box in generic contexts. If the box were a JVM value object, boxing would be much cheaper, and multi-field wrappers would become possible.
- An `opaque type` over a JVM value class would cost nothing even when its underlying value is a small aggregate rather than a single primitive.
- Scala's own initialization order puzzles (a `val` read as `null` during construction) are the kind of bug JEP 539's strict fields are designed to rule out — and that JEP is explicitly available to non-Java compilers.

Until then, the practical advice for Scala on JDK 28 is: keep using `opaque type` and `AnyVal` where they help, stop relying on `eq` for boxed values or `java.time` objects, and never lock on data objects.

<div class="takeaways">

## Key Takeaways

- Every identity object costs a **header** (8 bytes with compact headers, 12 with the legacy layout) and a **pointer**, which is expensive for small immutable values
- The root cause is **identity**; Valhalla's answer is to let classes opt out of it
- **JEP 401 Value Objects** is a **preview in JDK 28**: `value class` / `value record`, `--enable-preview --release 28`
- For value objects, **`==` compares class and field values** (recursively); keep using `equals` for logical equality
- No identity means no `synchronized` (`IdentityException`), no weak references, no finalization; check with `Objects.hasIdentity`
- With preview on, **30 JDK classes** become value classes, including `Integer`, `Optional`, and most of `java.time` — but not `String`
- The JVM may **scalarize** and **flatten** value objects, but flattening depends on the declared type, on size and atomicity (≤ 64 bits including a null flag for mutable locations), and on recompiled clients
- **JEP 539** adds strictly-initialized fields to the JVM: never seen as `0`/`null`, and trusted by the JIT
- **Null-restricted types** (`Point!`) and **specialized generics** (`List<int>`) are still drafts or far-future work
- Scala hasn't committed to an encoding yet; today, `AnyVal` and `opaque type` remain its tools, and boxed values change behaviour under preview

</div>
