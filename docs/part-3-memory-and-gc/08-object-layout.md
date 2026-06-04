# Chapter 8 — Object Layout in Memory

[← Part III](README.md) · [Next: GC Fundamentals →](09-gc-fundamentals.md)

---

## What Does an Object Actually Look Like?

When you write `new Object()` or `Person("Alice", 30)`, the JVM allocates a chunk of memory on the heap. But what's in that chunk? It's not just your data — there's overhead that the JVM needs for housekeeping.

Every object in the JVM has this structure:

```
┌──────────────────────────────────────────────────────┐
│                    OBJECT HEADER                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  Mark Word   │  │ Class Pointer│  │Array Length │  │
│  │  (8 bytes)   │  │ (4 or 8 b)  │  │(4 b, arrays│  │
│  │              │  │              │  │ only)       │  │
│  └──────────────┘  └──────────────┘  └────────────┘  │
├──────────────────────────────────────────────────────┤
│                   INSTANCE DATA                       │
│  Field 1 (e.g., int x = 3)                           │
│  Field 2 (e.g., int y = 4)                           │
│  Field 3 (e.g., String name → reference)              │
│  ...                                                  │
├──────────────────────────────────────────────────────┤
│                    PADDING                             │
│  (0–7 bytes to align to 8-byte boundary)              │
└──────────────────────────────────────────────────────┘
```

Let's break this down.

## The Mark Word

The **mark word** is 8 bytes (64 bits) on a 64-bit JVM. It's a multipurpose field that stores different information depending on the object's current state:

```
Normal state (unlocked):
┌────────────┬──────┬──────┬───────┬─────────┐
│  Unused    │ Hash │ Age  │ Bias  │  Lock   │
│ (25 bits)  │ Code │(4 b) │(1 bit)│ (2 bits)│
│            │(31 b)│      │       │         │
└────────────┴──────┴──────┴───────┴─────────┘
```

What's packed in there:

| Field                   | Bits | Purpose                                                                                                                                                       |
| ----------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identity hash code**  | 31   | The value returned by `System.identityHashCode()`. Computed lazily — only generated when first requested.                                                     |
| **GC age**              | 4    | How many GC cycles this object has survived. When it reaches the threshold (default 15), the object is promoted to the old generation. 4 bits = max value 15. |
| **Biased locking flag** | 1    | Whether this object is biased toward a particular thread (deprecated in Java 15, removed in Java 18).                                                         |
| **Lock state**          | 2    | `00` = unlocked, `01` = biased, `10` = lightweight locked, `11` = heavyweight locked (monitor).                                                               |

When the object is used as a lock (`synchronized`), the mark word is **repurposed** to store lock information:

- **Lightweight lock**: Points to a lock record on the owning thread's stack
- **Heavyweight lock**: Points to an ObjectMonitor (a native mutex)
- **During GC**: Used as a forwarding pointer (points to the object's new location after compaction)

> **This is why `synchronized` and `hashCode()` don't play well together**: Both want to use the mark word. If you call `hashCode()` on a biased-locked object, the JVM has to revoke the bias to store the hash code. This is one of the subtle costs of using `synchronized`.

## The Class Pointer (Klass Pointer)

The class pointer tells the JVM *what type* this object is. It points to the class's metadata in Metaspace (the `Klass` structure in HotSpot's C++ implementation).

On a 64-bit JVM:
- Without compressed OOPs: 8 bytes
- With compressed OOPs (default for heaps < 32 GB): **4 bytes**

This pointer is how the JVM does:
- `instanceof` checks
- Virtual method dispatch (find the vtable)
- `getClass()` — follows this pointer to get the `java.lang.Class` mirror

## Array Length

Only present for arrays. A 4-byte integer giving the array's length. This is why `array.length` is O(1) — it's read directly from the object header.

## Instance Data

After the header come your actual fields, laid out in memory. The JVM reorders fields to minimize padding:

```java
public class Example {
    boolean flag;    // 1 byte
    long value;      // 8 bytes
    int count;       // 4 bytes
    char letter;     // 2 bytes
}
```

Naive layout would waste space due to alignment:

```
Naive layout (lots of padding):
| flag (1) | pad (7) | value (8) | count (4) | letter (2) | pad (2) |
Total: 24 bytes of data + 9 bytes padding = bad
```

The JVM reorders fields by size (largest first) to minimize padding:

```
Optimized layout:
| value (8) | count (4) | letter (2) | flag (1) | pad (1) |
Total: 16 bytes of data + 1 byte padding = much better
```

### Field Sizes

| Type              | Size                            |
| ----------------- | ------------------------------- |
| `boolean`, `byte` | 1 byte                          |
| `char`, `short`   | 2 bytes                         |
| `int`, `float`    | 4 bytes                         |
| `long`, `double`  | 8 bytes                         |
| Object reference  | 4 bytes (compressed) or 8 bytes |

## Padding (Alignment)

Every object's total size is rounded up to a multiple of **8 bytes**. This is called **object alignment** and exists because modern CPUs access memory more efficiently at aligned boundaries.

Even an object with no fields at all (`new Object()`) has overhead:

```
new Object():
  Mark word:      8 bytes
  Class pointer:  4 bytes (compressed)
  Padding:        4 bytes (to reach 16-byte boundary)
  Total:         16 bytes!
```

Yes — an empty object costs 16 bytes. A `java.lang.Integer` wrapping a 4-byte `int` costs 16 bytes too (8 + 4 + 4). That's **4x overhead** for boxing a single integer.

## Compressed OOPs (Ordinary Object Pointers)

On a 64-bit JVM, object references (pointers) would naturally be 8 bytes. But most applications don't need to address more than 32 GB of heap. So the JVM uses a trick: **compressed OOPs**.

Since objects are aligned to 8-byte boundaries, the last 3 bits of every address are always 0. Instead of storing the full 64-bit address, the JVM stores the address shifted right by 3 bits — fitting it into 32 bits.

```
Real address:    0x00000001_23456780  (64 bits)
Compressed:      0x02468ACF           (32 bits, shifted right by 3)
To use:          Shift left by 3 to recover the real address
```

This means:
- References are 4 bytes instead of 8 → significant memory savings
- Can address up to 2³² × 8 = 32 GB of heap
- Enabled by default when heap < 32 GB (`-XX:+UseCompressedOops`)

> **Performance tip**: If your application uses 33 GB of heap, you might actually get better performance by reducing it to 31 GB — because switching from compressed to uncompressed OOPs increases every reference by 4 bytes, which can increase total memory usage and cache pressure significantly.

## Example: Inspecting Object Layout with JOL

[JOL (Java Object Layout)](https://openjdk.org/projects/code-tools/jol/) is a tool that shows you exactly how objects are laid out in memory. Let's look at a Scala case class:

```scala
case class Person(name: String, age: Int)
```

Using JOL (with a small Java wrapper):

```java
import org.openjdk.jol.info.ClassLayout;

public class JolExample {
    public static void main(String[] args) {
        Person p = new Person("Alice", 30);
        System.out.println(ClassLayout.parseInstance(p).toPrintable());
    }
}
```

Output (approximately):

```
Person object internals:
OFF  SZ                TYPE DESCRIPTION               VALUE
  0   8                     (object header: mark)      0x0000000000000001
  8   4                     (object header: class)     0x00c00208
 12   4                 int Person.age                  30
 16   4    java.lang.String Person.name                 (object)
 20   4                     (object alignment gap)
Instance size: 24 bytes
Space losses: 0 bytes internal + 4 bytes external = 4 bytes total
```

So a `Person` with a `String` name and `int` age costs:
- 12 bytes header (mark word + class pointer)
- 4 bytes for `age`
- 4 bytes for the reference to `name` (the `String` object itself is *additional* memory elsewhere)
- 4 bytes padding
- **Total: 24 bytes** (plus whatever the `String` costs)

> **Scala `AnyVal`**: Scala's `AnyVal` types (like `case class UserId(value: Long) extends AnyVal`) are meant to avoid this overhead — the compiler erases the wrapper and uses the raw value in many cases. However, boxing still occurs when the value type is used in generic contexts or collections. Scala 3's `opaque type` is a more reliable way to avoid boxing.

## The Cost of Boxing

Understanding object layout makes the cost of boxing crystal clear:

```scala
val x: Int = 42          // 4 bytes on the stack (primitive)
val y: Integer = 42      // 16 bytes on the heap (object header + 4-byte int + padding)
val z: Any = 42           // Scala boxes it → same as Integer: 16 bytes on the heap
```

An `Array[Int]` in Scala stores raw integers (4 bytes each). But a `List[Int]` boxes every integer into a `java.lang.Integer`, each costing 16 bytes plus the list node overhead.

```
Array[Int] with 1000 elements:
  16 bytes (array header) + 4 × 1000 = 4,016 bytes

List[Int] with 1000 elements (simplified):
  Each element: 16 bytes (Integer) + ~32 bytes (cons cell)
  Total: ~48,000 bytes  →  12x more!
```

This is why performance-critical Scala code often uses `Array` instead of `List` for primitive types, or specialized libraries like `spire` that avoid boxing.

## Project Lilliput: Smaller Headers

The 12–16 byte object header is a significant overhead, especially for small objects. **Project Lilliput** aims to reduce the object header to just **8 bytes** by compressing the mark word and class pointer:

```
Current:   mark word (8) + klass pointer (4) = 12 bytes minimum
Lilliput:  combined header = 8 bytes
```

This would save 4 bytes per object. For an application with millions of small objects, that's a significant reduction. Lilliput has been experimental since Java 22.

## Key Takeaways

- Every object has a **header** (mark word + class pointer) that costs at least 12 bytes (16 with alignment)
- The **mark word** stores identity hash code, GC age, and lock state — all packed into 8 bytes
- The JVM **reorders fields** to minimize padding waste
- **Compressed OOPs** reduce reference size from 8 to 4 bytes (default for heaps < 32 GB)
- An empty `Object()` costs 16 bytes; a boxed `Integer` costs 16 bytes for a 4-byte value
- Boxing overhead is a real concern for Scala, especially in generic collections
- **JOL** is an invaluable tool for inspecting actual memory layouts
- **Project Lilliput** aims to halve the object header size

---

[← Part III](README.md) · [Next: GC Fundamentals →](09-gc-fundamentals.md)
