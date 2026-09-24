# Chapter 8 — Object Layout in Memory

## What Does an Object Actually Look Like?

When you write `new Object()` or `Person("Alice", 30)`, the JVM allocates a chunk of memory on the heap. But what's in that chunk? It's not just your data: there is also some overhead the JVM needs for housekeeping.

Every object in HotSpot is made of three parts:

1. A **header**: who am I (my class), my identity hash code, my GC age, my lock state. Arrays also store their length here.
2. The **instance data**: your fields.
3. **Padding**, so that the next object starts on an 8-byte boundary.

The header is where things got interesting recently. HotSpot now has **two header layouts**:

| Layout                          | Header size (64-bit JVM) | Status                                                                                                             |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Legacy**                      | 12 bytes (96 bits)       | The only layout up to Java 23; still available with `-XX:-UseCompactObjectHeaders`                                 |
| **Compact** (Project Lilliput)  | 8 bytes (64 bits)        | Experimental in 24 (JEP 450), product in 25 (JEP 519), <span class="since">Default in 27</span> (JEP 534)          |

Here is the legacy layout, byte by byte:

```text
Legacy layout (-XX:-UseCompactObjectHeaders)

offset
  0 ┌──────────────────────────────────────┐ ─┐
    │ mark word                  8 bytes   │  │
  8 ├──────────────────────────────────────┤  │ header: 12 bytes
    │ compressed class pointer   4 bytes   │  │ (16 for arrays)
 12 ├──────────────────────────────────────┤ ─┤
    │ array length   4 bytes (arrays only) │  │
    ├──────────────────────────────────────┤ ─┘
    │ instance data (your fields)          │
    ├──────────────────────────────────────┤
    │ padding up to a multiple of 8        │
    └──────────────────────────────────────┘
```

And here is the compact layout, the default since JDK 27. The class pointer has been squeezed *into* the mark word:

```text
Compact layout (default in JDK 27)

offset
  0 ┌──────────────────────────────────────┐ ─┐
    │ header                     8 bytes   │  │ header: 8 bytes
    │ (class id + hash + age + lock bits)  │  │ (12 for arrays)
  8 ├──────────────────────────────────────┤ ─┤
    │ array length   4 bytes (arrays only) │  │
    ├──────────────────────────────────────┤ ─┘
    │ instance data (your fields)          │
    ├──────────────────────────────────────┤
    │ padding up to a multiple of 8        │
    └──────────────────────────────────────┘
```

Four bytes per object doesn't sound like much. But a typical Java or Scala heap is full of small objects (boxed numbers, tuples, `Option`s, list cells, map entries…), and for those four bytes can be 15–25% of the whole object. Let's look at each part in turn.

## The Mark Word

The **mark word** is the first 64 bits of every object. It is a multipurpose field: it stores different information depending on what state the object is in. Here is what it looks like on a current (JDK 27) 64-bit JVM, for an ordinary unlocked object, in both layouts:

```text
Legacy mark word (followed by a separate 4-byte class pointer)
 63            42 41                  11 10     7 6     3   2   1  0
┌────────────────┬──────────────────────┬────────┬───────┬─────┬─────┐
│   unused (22)  │ identity hash (31)   │ Vh (4) │age (4)│ SF  │lock │
└────────────────┴──────────────────────┴────────┴───────┴─────┴─────┘

Compact header (the whole header)
 63            42 41                  11 10     7 6     3   2   1  0
┌────────────────┬──────────────────────┬────────┬───────┬─────┬─────┐
│ class id (22)  │ identity hash (31)   │ Vh (4) │age (4)│ SF  │lock │
└────────────────┴──────────────────────┴────────┴───────┴─────┴─────┘

Vh = reserved for Valhalla    SF = self-forwarded (GC)    lock = 2 bits
```

The trick of compact headers is visible right there: the legacy mark word had 22 unused bits at the top. The compact layout puts a 22-bit *class id* in them, and the separate 4-byte class pointer disappears.

| Field                  | Bits | Purpose                                                                                                                                                              |
| ---------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Class id**           | 22   | Compact layout only: identifies the object's class (see [below](#the-class-pointer-klass-pointer)).                                                                   |
| **Identity hash code** | 31   | The value returned by `System.identityHashCode()` (and by `Object.hashCode()` if you don't override it). Computed lazily and stored here the first time it's asked for. |
| **Valhalla bits**      | 4    | Reserved for [Project Valhalla](../part-4-type-system/14-value-types-valhalla.md): marks value objects and flattened arrays.                                           |
| **GC age**             | 4    | How many young collections this object has survived. At the tenuring threshold (at most 15, since 4 bits can't count higher) it is promoted to the old generation.      |
| **Self-forwarded**     | 1    | Used by some collectors when an object couldn't be moved during evacuation and is "forwarded to itself".                                                              |
| **Lock bits**          | 2    | The object's lock / GC state, see the table below.                                                                                                                    |

### The lock bits

The two lowest bits tell the JVM how to interpret the rest of the word:

| Lock bits | State                          | What the rest of the header holds                                                                                                                         |
| --------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01`      | **Unlocked** (normal)          | Hash, age, etc. as shown above. This is the state of almost every object, almost all the time.                                                            |
| `00`      | **Lightweight-locked**         | Header unchanged; the owning thread records the object on its own small *lock stack*.                                                                      |
| `10`      | **Inflated** (monitor)         | The lock is contended or someone called `wait()`: the JVM has created a full `ObjectMonitor`. Since JDK 27 that monitor is found through a side table, and the header stays intact. |
| `11`      | **Marked** (GC)                | Used by the GC while moving objects: the header is replaced by a forwarding pointer to the object's new location.                                          |

> [!NOTE]
> Older articles (and earlier editions of this book) show a "biased lock" bit and a `101` pattern. **Biased locking** was deprecated in Java 15 (JEP 374) and removed in Java 18. That bit is now the self-forwarded bit. If you see `-XX:+UseBiasedLocking` in an old start script, delete it: modern JVMs refuse to start with it.

### Lightweight locking

When you write `synchronized (obj) { … }` in Java (or `obj.synchronized { … }` in Scala), the JVM first tries a cheap, uncontended lock. How it does that changed recently:

- **Legacy stack-locking** (the old way) copied the mark word onto the thread's stack and replaced it with a *pointer* to that copy. Anyone who wanted the hash code, the age, or (with compact headers) the class had to chase that pointer first.
- **Lightweight locking** (the new way) just flips the lock bits to `00` and pushes the object onto a small per-thread *lock stack*. The header keeps its content, which is exactly what compact headers need: the class id must always be readable.

Lightweight locking arrived in JDK 21 behind `-XX:LockingMode=2`, became the default in JDK 23, and the `LockingMode` flag was deprecated in 24, stopped being settable in 26, and is gone in 27. Likewise, inflated monitors used to be stored by *overwriting* the header with a pointer; with compact headers (and, since JDK 27, by default in both layouts) HotSpot keeps them in a separate **object monitor table** instead.

> **Why `hashCode()` used to hurt locks**: in the biased-locking days, calling `System.identityHashCode()` on a biased object forced the JVM to revoke the bias, which was surprisingly expensive. With biased locking gone and lightweight locking keeping the header intact, the hash code and a lock now happily coexist.

### Identity hash codes with compact headers

Compact headers keep the full **31-bit identity hash** in the header, in the same place as before, so `System.identityHashCode()` and `HashMap` behave exactly as they always did. The hash is still computed lazily: objects that are never hashed simply leave those bits at zero. (Future Lilliput work — 4-byte headers, currently a draft — will need to move the hash out of the header for objects that actually get hashed, but that's not in any release yet.)

## The Class Pointer (Klass Pointer)

The JVM needs to know *what type* each object is. That information lives in the class's metadata in Metaspace (the `Klass` structure in HotSpot's C++ code). The header points to it, and that pointer is how the JVM does:

- `instanceof` checks and casts
- virtual method dispatch (find the vtable, see [Chapter 13](../part-4-type-system/13-inheritance-and-dispatch.md))
- `getClass()`, which follows it to the `java.lang.Class` mirror

The two layouts store it differently:

- **Legacy layout**: a separate 4-byte **compressed class pointer**, an offset into a dedicated *compressed class space* in Metaspace. (Uncompressed 8-byte class pointers used to be possible with `-XX:-UseCompressedClassPointers`; that flag was deprecated in JDK 25 and is obsolete in 27, so class pointers are now always compressed.)
- **Compact layout**: a 22-bit **class id** stored in the top of the header. HotSpot places class metadata so that 22 bits are enough to find it, and that still leaves room for about 4 million classes, far more than any real application loads.

> [!NOTE]
> Don't confuse *compressed class pointers* (how the header refers to the class) with *compressed oops* (how your fields refer to other objects, [see below](#compressed-oops-ordinary-object-pointers)). They are independent: compressed class pointers work whatever your heap size, while compressed oops switch off above ~32 GB of heap.

## Array Length

Only present for arrays: a 4-byte integer giving the array's length, right after the header (offset 12 in the legacy layout, offset 8 in the compact one). This is why `array.length` is O(1): it's read directly from the object.

## Instance Data

After the header come your actual fields. The JVM doesn't have to lay them out in declaration order, and it doesn't: it **reorders fields** to minimise padding, and it will happily slip a small field into a gap left by the header.

```java
public class Example {
    boolean flag;    // 1 byte
    long value;      // 8 bytes
    int count;       // 4 bytes
    char letter;     // 2 bytes
}
```

Let's first imagine the fields in declaration order, with a compact 8-byte header. Every field must be aligned to its own size, so the `long` can't start right after the `boolean`:

```text
Declaration order (not what the JVM does), compact header:
| header (8) | flag (1) | gap (7) | value (8) | count (4) | letter (2) | pad (2) |
Total: 32 bytes, 9 of them wasted
```

Here's what HotSpot actually does (as measured with JOL):

```text
Compact header (default in 27):
| header (8) | value (8) | count (4) | letter (2) | flag (1) | pad (1) |
Total: 24 bytes

Legacy header:
| mark (8) | class (4) | count (4) | value (8) | letter (2) | flag (1) | pad (5) |
Total: 32 bytes
```

Notice two things. In the compact layout, sorting the fields from largest to smallest leaves almost nothing to pad. In the legacy layout, the JVM fills the 4-byte hole after the 12-byte header with `count`, because the `long` has to start at offset 16 anyway. Even so, the legacy object ends up 8 bytes larger: 33% more for the same data.

### Field Sizes

| Type              | Size                                             |
| ----------------- | ------------------------------------------------ |
| `boolean`, `byte` | 1 byte                                           |
| `char`, `short`   | 2 bytes                                          |
| `int`, `float`    | 4 bytes                                          |
| `long`, `double`  | 8 bytes                                          |
| Object reference  | 4 bytes (compressed oops, the default) or 8 bytes |

## Padding (Alignment)

Every object's total size is rounded up to a multiple of **8 bytes** (`-XX:ObjectAlignmentInBytes`, default 8). This is called **object alignment**: it keeps fields naturally aligned for the CPU, and it's also what makes compressed oops work.

So what does an object with no fields at all cost?

```text
new Object(), legacy layout:          new Object(), compact layout:
  Mark word:      8 bytes               Header:         8 bytes
  Class pointer:  4 bytes               Padding:        0 bytes
  Padding:        4 bytes               Total:          8 bytes
  Total:         16 bytes
```

With compact headers, an empty object is just its header: **8 bytes**, half of what it used to be. A `java.lang.Integer` (one `int` field) costs 16 bytes in both layouts: 8 + 4 + 4 bytes of padding in the compact layout, 12 + 4 in the legacy one. That's still **4x** the size of the `int` it wraps.

| Object                                 | Legacy header | Compact header |
| -------------------------------------- | ------------- | -------------- |
| `new Object()`                         | 16 bytes      | **8 bytes**    |
| `Integer`, `Float`                     | 16 bytes      | 16 bytes       |
| `Long`, `Double`                       | 24 bytes      | **16 bytes**   |
| `Person(name: String, age: Int)`       | 24 bytes      | **16 bytes**   |
| `Example` above                        | 32 bytes      | **24 bytes**   |
| `new int[0]`                           | 16 bytes      | 16 bytes       |
| `new int[1000]`                        | 4,016 bytes   | 4,016 bytes    |

Objects with a 4-byte field left over after an 8-byte multiple gain nothing; objects that used to spill into the next 8 bytes because of the class pointer shrink by 8. On real workloads it adds up: JEP 534 reports **22% less heap, 8% less CPU time and 15% fewer collections** on SPECjbb2015.

## Compressed OOPs (Ordinary Object Pointers)

On a 64-bit JVM, object references would naturally be 8 bytes. But most applications don't need to address more than 32 GB of heap. So the JVM uses a trick: **compressed oops**.

Since objects are aligned to 8-byte boundaries, the last 3 bits of every address are always 0. Instead of storing the full 64-bit address, the JVM stores the address shifted right by 3 bits, which fits in 32 bits.

```text
Real address:    0x00000001_23456780  (64 bits, last 3 bits always 0)
Compressed:      0x2468ACF0           (32 bits: address >> 3)
To use:          shift left by 3 (and add the heap base, if any)
```

This means:

- References are 4 bytes instead of 8, a significant memory saving
- The JVM can address up to 2³² × 8 bytes = 32 GB of heap
- Enabled by default when the maximum heap is below that limit (`-XX:+UseCompressedOops`)

> [!TIP]
> If your application uses 33 GB of heap, you might actually get *better* performance by reducing it to 31 GB: crossing the limit makes every reference field 8 bytes, which increases total memory usage and cache pressure. (Raising `-XX:ObjectAlignmentInBytes` to 16 pushes the limit to 64 GB, at the cost of more padding.)

## Example: Inspecting Object Layout with JOL

[JOL (Java Object Layout)](https://github.com/openjdk/jol) is a small tool that shows you exactly how objects are laid out in memory. Let's look at a Scala case class:

```scala
case class Person(name: String, age: Int)
```

Using JOL (with a small Java wrapper):

```java
import org.openjdk.jol.info.ClassLayout;

public class JolExample {
    public static void main(String[] args) {
        var p = new Person("Alice", 30);
        System.out.println(ClassLayout.parseInstance(p).toPrintable());
    }
}
```

On JDK 27 with the default **compact headers**:

```text
Person object internals:
OFF  SZ               TYPE DESCRIPTION               VALUE
  0   8                    (object header: mark)     0x0104040000000001 (Lilliput)
  8   4                int Person.age                30
 12   4   java.lang.String Person.name               (object)
Instance size: 16 bytes
Space losses: 0 bytes internal + 0 bytes external = 0 bytes total
```

The same program with the **legacy layout** (`-XX:-UseCompactObjectHeaders`, or any JDK before 27 without `-XX:+UseCompactObjectHeaders`):

```text
Person object internals:
OFF  SZ               TYPE DESCRIPTION               VALUE
  0   8                    (object header: mark)     0x0000000000000001 (non-biasable; age: 0)
  8   4                    (object header: class)    0x01040210
 12   4                int Person.age                30
 16   4   java.lang.String Person.name               (object)
 20   4                    (object alignment gap)
Instance size: 24 bytes
Space losses: 0 bytes internal + 4 bytes external = 4 bytes total
```

So a `Person` costs:

| Part                          | Legacy       | Compact      |
| ----------------------------- | ------------ | ------------ |
| Header                        | 12 bytes     | 8 bytes      |
| `age`                         | 4 bytes      | 4 bytes      |
| Reference to `name`           | 4 bytes      | 4 bytes      |
| Padding                       | 4 bytes      | 0 bytes      |
| **Total**                     | **24 bytes** | **16 bytes** |

In both cases the `String` itself (and its `byte[]`) is *additional* memory elsewhere on the heap. In the mark word values you can also see the lock bits `01` (unlocked) at the very end, and, in the compact case, the class id sitting in the top bits.

> [!TIP]
> Use a recent JOL (0.17 or later) — it recognises compact headers and labels them `(Lilliput)`. And when you compare numbers from a blog post, check which layout it was measured with.

> **Scala `AnyVal`**: Scala's `AnyVal` types (like `case class UserId(value: Long) extends AnyVal`) are meant to avoid this overhead: the compiler erases the wrapper and uses the raw value in many cases. However, boxing still occurs when the value type is used in generic contexts or collections. Scala 3's `opaque type` is a more reliable way to avoid boxing.

## The Cost of Boxing

Understanding object layout makes the cost of boxing crystal clear:

```scala
val x: Int = 42          // 4 bytes, in a register or on the stack (primitive)
val y: Integer = 1000    // 16 bytes on the heap (header + 4-byte int + padding)
val z: Any = 1000        // Scala boxes it → same as Integer: 16 bytes on the heap
```

(Small values between -128 and 127 come from a shared cache, so `Integer.valueOf(42)` doesn't allocate. Larger ones do.)

An `Array[Int]` in Scala stores raw integers (4 bytes each). But a `List[Int]` boxes every integer into a `java.lang.Integer`, and adds a cons cell (`::`, with a `head` and a `next` reference) per element:

```text
Array[Int] with 1000 elements:
  16 bytes (array header) + 4 × 1000        =  4,016 bytes

List[Int] with 1000 elements (values outside the Integer cache):
  legacy:  (16 Integer + 24 cons cell) × 1000 ≈ 40,000 bytes   → 10x
  compact: (16 Integer + 16 cons cell) × 1000 ≈ 32,000 bytes   →  8x
```

Compact headers make the list noticeably cheaper, but boxing is still an order of magnitude more expensive than a primitive array. This is why performance-critical Scala code often uses `Array` instead of `List` for primitive types, or specialised libraries that avoid boxing.

## Project Lilliput: From Experiment to Default

Compact object headers are the first deliverable of **Project Lilliput**, whose goal is to shrink object headers:

<p class="timeline-title">Compact object headers</p>
<ol class="timeline">
<li><span class="when">JDK 24 (Mar 2025)</span>JEP 450 - experimental, opt-in</li>
<li><span class="when">JDK 25 LTS (Sep 2025)</span>JEP 519 - product feature, still opt-in</li>
<li><span class="when">JDK 27 (Sep 2026)</span>JEP 534 - on by default</li>
<li class="future"><span class="when">Future</span>4-byte headers (draft JEP)</li>
</ol>

What this means for you:

- **On JDK 27** you get compact headers for free. Opt out with `-XX:-UseCompactObjectHeaders` only if you hit a problem (for instance a native agent or library that assumes the old layout). The old layout is expected to be deprecated in a later release.
- **On JDK 25 LTS** it's a supported, one-flag win: try `-XX:+UseCompactObjectHeaders` and measure. (On JDK 24 it also needs `-XX:+UnlockExperimentalVMOptions`.)
- **Next steps**: Lilliput is exploring 4-byte headers (a draft JEP), and the four reserved Valhalla bits are there for **value objects** (JEP 401, preview in JDK 28), which have no identity at all and can often be flattened into their container with no header of their own. That's the subject of [Chapter 14](../part-4-type-system/14-value-types-valhalla.md).

<div class="takeaways">

## Key Takeaways

- Every object has a **header**, then its **fields**, then **padding** to an 8-byte boundary
- HotSpot has two header layouts: **legacy** (8-byte mark word + 4-byte class pointer = 12 bytes) and **compact** (8 bytes, class id folded into the mark word), which is the **default since JDK 27**
- The **mark word** stores the identity hash (31 bits), GC age (4 bits), and 2 lock bits: `01` unlocked, `00` lightweight-locked, `10` inflated monitor, `11` marked by the GC
- **Biased locking** is gone (removed in 18); **lightweight locking** is the only fast-locking mode since JDK 26, and it keeps the header intact
- The JVM **reorders fields** to minimise padding and fills header gaps
- **Compressed oops** make references 4 bytes for heaps under ~32 GB; don't confuse them with compressed class pointers
- `new Object()` is 16 bytes with legacy headers and **8 bytes** with compact headers; a boxed `Integer` is 16 bytes either way
- Boxing is still expensive for Scala generic collections; Valhalla value objects are the long-term fix
- **JOL** (0.17+) shows you the real layout; always note which header layout you measured

</div>
