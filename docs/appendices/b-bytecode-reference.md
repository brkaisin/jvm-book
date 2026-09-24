# Appendix B — Bytecode Instruction Reference

JVM bytecode has a little over 200 instructions (opcodes 0 to 201, plus a few reserved ones). Here they are, grouped by category. Each instruction starts with a one-byte **opcode**, optionally followed by operands. To see the bytecode of any class, run `javap -c -p MyClass.class`.

## Stack Manipulation

| Opcode   | Description                                 |
| -------- | ------------------------------------------- |
| `nop`    | Do nothing                                  |
| `pop`    | Pop top value from stack                    |
| `pop2`   | Pop top two values (or one long/double)     |
| `dup`    | Duplicate top value                         |
| `dup_x1` | Duplicate top value and insert below second |
| `dup_x2` | Duplicate top value and insert below third  |
| `dup2`   | Duplicate top two values                    |
| `swap`   | Swap top two values                         |

## Constants

| Opcode                             | Description                                         |
| ---------------------------------- | --------------------------------------------------- |
| `iconst_m1` to `iconst_5`          | Push int constant -1 to 5                           |
| `lconst_0`, `lconst_1`             | Push long 0 or 1                                    |
| `fconst_0`, `fconst_1`, `fconst_2` | Push float 0, 1, or 2                               |
| `dconst_0`, `dconst_1`             | Push double 0 or 1                                  |
| `bipush <byte>`                    | Push byte as int                                    |
| `sipush <short>`                   | Push short as int                                   |
| `ldc <index>`                      | Push constant from pool (int, float, String, Class, MethodType, MethodHandle, dynamic constant) |
| `ldc_w <index>`                    | Wide index version of ldc                           |
| `ldc2_w <index>`                   | Push long or double from constant pool (incl. dynamic constants) |
| `aconst_null`                      | Push null reference                                 |

## Local Variable Access

Local variables are stored in numbered slots. Slot 0 is `this` for instance methods.

### Load (variable → stack)

| Opcode                             | Type      |
| ---------------------------------- | --------- |
| `iload <n>` / `iload_0`..`iload_3` | int       |
| `lload <n>` / `lload_0`..`lload_3` | long      |
| `fload <n>` / `fload_0`..`fload_3` | float     |
| `dload <n>` / `dload_0`..`dload_3` | double    |
| `aload <n>` / `aload_0`..`aload_3` | reference |

### Store (stack → variable)

| Opcode                                | Type      |
| ------------------------------------- | --------- |
| `istore <n>` / `istore_0`..`istore_3` | int       |
| `lstore <n>` / `lstore_0`..`lstore_3` | long      |
| `fstore <n>` / `fstore_0`..`fstore_3` | float     |
| `dstore <n>` / `dstore_0`..`dstore_3` | double    |
| `astore <n>` / `astore_0`..`astore_3` | reference |

## Arithmetic

### Integer

| Opcode               | Operation                                   |
| -------------------- | ------------------------------------------- |
| `iadd`               | a + b                                       |
| `isub`               | a - b                                       |
| `imul`               | a * b                                       |
| `idiv`               | a / b (throws ArithmeticException if b = 0) |
| `irem`               | a % b                                       |
| `ineg`               | -a                                          |
| `iinc <var> <const>` | Increment local variable by constant        |

### Long, Float, Double

Same pattern with `l`, `f`, `d` prefix: `ladd`, `fadd`, `dadd`, etc.

### Bitwise (int and long)

| Opcode            | Operation                               |
| ----------------- | --------------------------------------- |
| `ishl` / `lshl`   | Left shift                              |
| `ishr` / `lshr`   | Arithmetic right shift (sign-extending) |
| `iushr` / `lushr` | Logical right shift (zero-extending)    |
| `iand` / `land`   | Bitwise AND                             |
| `ior` / `lor`     | Bitwise OR                              |
| `ixor` / `lxor`   | Bitwise XOR                             |

## Type Conversion

| Opcode              | Conversion                           |
| ------------------- | ------------------------------------ |
| `i2l`, `i2f`, `i2d` | int → long, float, double            |
| `l2i`, `l2f`, `l2d` | long → int, float, double            |
| `f2i`, `f2l`, `f2d` | float → int, long, double            |
| `d2i`, `d2l`, `d2f` | double → int, long, float            |
| `i2b`, `i2c`, `i2s` | int → byte, char, short (truncation) |

## Array Operations

| Opcode                                                | Description                     |
| ----------------------------------------------------- | ------------------------------- |
| `newarray <type>`                                     | Create primitive array          |
| `anewarray <class>`                                   | Create reference array          |
| `multianewarray <class> <dims>`                       | Create multi-dimensional array  |
| `arraylength`                                         | Get array length                |
| `iaload`, `laload`, `faload`, `daload`, `aaload`      | Load from array                 |
| `baload`, `caload`, `saload`                          | Load byte/char/short from array |
| `iastore`, `lastore`, `fastore`, `dastore`, `aastore` | Store to array                  |
| `bastore`, `castore`, `sastore`                       | Store byte/char/short to array  |

## Object Operations

| Opcode               | Description                                      |
| -------------------- | ------------------------------------------------ |
| `new <class>`        | Allocate object (uninitialized)                  |
| `getfield <field>`   | Get instance field                               |
| `putfield <field>`   | Set instance field                               |
| `getstatic <field>`  | Get static field                                 |
| `putstatic <field>`  | Set static field                                 |
| `instanceof <class>` | Test if object is instance of class (→ 0 or 1)   |
| `checkcast <class>`  | Cast object (throws ClassCastException if fails) |

## Method Invocation

| Opcode                                                | Use case                                              |
| ----------------------------------------------------- | ----------------------------------------------------- |
| `invokevirtual`                                       | Instance methods (virtual dispatch via vtable); also private methods since Java 11 (nestmates) |
| `invokeinterface`                                     | Interface methods (dispatch via itable)               |
| `invokespecial`                                       | Constructors (`<init>`), `super.m()` calls            |
| `invokestatic`                                        | Static methods                                        |
| `invokedynamic`                                       | Bootstrap-linked calls (lambdas, string concat, records' `toString`/`equals`/`hashCode`, pattern `switch`) |
| `return`                                              | Return void                                           |
| `ireturn`, `lreturn`, `freturn`, `dreturn`, `areturn` | Return typed value                                    |

## Branching and Comparison

### Comparisons (push result to stack)

| Opcode           | Description                                 |
| ---------------- | ------------------------------------------- |
| `lcmp`           | Compare two longs → -1, 0, or 1             |
| `fcmpg`, `fcmpl` | Compare two floats (differ in NaN handling) |
| `dcmpg`, `dcmpl` | Compare two doubles                         |

### Conditional Branches (int)

| Opcode      | Branch if... |
| ----------- | ------------ |
| `ifeq`      | value == 0   |
| `ifne`      | value != 0   |
| `iflt`      | value < 0    |
| `ifge`      | value >= 0   |
| `ifgt`      | value > 0    |
| `ifle`      | value <= 0   |
| `if_icmpeq` | a == b       |
| `if_icmpne` | a != b       |
| `if_icmplt` | a < b        |
| `if_icmpge` | a >= b       |
| `if_icmpgt` | a > b        |
| `if_icmple` | a <= b       |

### Conditional Branches (reference)

| Opcode      | Branch if...               |
| ----------- | -------------------------- |
| `if_acmpeq` | ref1 == ref2 (same object) |
| `if_acmpne` | ref1 != ref2               |
| `ifnull`    | ref == null                |
| `ifnonnull` | ref != null                |

### Unconditional

| Opcode            | Description                                |
| ----------------- | ------------------------------------------ |
| `goto <offset>`   | Jump to offset                             |
| `goto_w <offset>` | Wide jump                                  |
| `tableswitch`     | Switch with consecutive keys (jump table)  |
| `lookupswitch`    | Switch with arbitrary keys (binary search) |

`jsr` and `ret` (old subroutines used for `finally`) are forbidden in class files for Java 7+ (version 51+); `javac` duplicates `finally` blocks instead.

> [!NOTE]
> With Valhalla's value objects (preview in JDK 28), `if_acmpeq`/`if_acmpne` on two value objects compare their class and field values, since value objects have no identity. That's what makes `==` on value objects mean "same value".

## Exception Handling

| Opcode            | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `athrow`          | Throw exception                                                   |
| (exception table) | Not an opcode — try/catch is encoded as a table in the class file |

```text
Exception table:
  from   to  target type
    0     8    11   Class java/lang/Exception
```

This means: "If an exception of type `Exception` is thrown between bytecodes 0 and 8, jump to bytecode 11."

## Synchronization

| Opcode         | Description                        |
| -------------- | ---------------------------------- |
| `monitorenter` | Acquire monitor (lock) on object   |
| `monitorexit`  | Release monitor (unlock) on object |

`synchronized` blocks compile to `monitorenter` / `monitorexit` pairs (plus an exception handler that releases the lock). `synchronized` methods use the `ACC_SYNCHRONIZED` access flag instead.

## Miscellaneous

| Opcode   | Description                                                                         |
| -------- | ----------------------------------------------------------------------------------- |
| `wide`   | Prefix: the next load/store/`iinc` uses a 16-bit local-variable index (or constant) |
| `breakpoint`, `impdep1`, `impdep2` | Reserved for debuggers and JVM internals; never in class files |

## Class File Versions

Every `.class` file starts with `CAFEBABE` followed by a minor and major version. A JVM refuses to load a class whose major version is newer than it supports (`UnsupportedClassVersionError`). Classes compiled with `--enable-preview` also have minor version `65535` and only run on that exact release with `--enable-preview`.

| Java | Major | Java | Major | Java | Major |
| ---- | ----- | ---- | ----- | ---- | ----- |
| 1.1  | 45    | 11   | 55    | 20   | 64    |
| 1.2  | 46    | 12   | 56    | 21   | 65    |
| 1.3  | 47    | 13   | 57    | 22   | 66    |
| 1.4  | 48    | 14   | 58    | 23   | 67    |
| 5    | 49    | 15   | 59    | 24   | 68    |
| 6    | 50    | 16   | 60    | 25   | 69    |
| 7    | 51    | 17   | 61    | 26   | 70    |
| 8    | 52    | 18   | 62    | 27   | 71    |
| 9    | 53    | 19   | 63    | 28   | 72    |
| 10   | 54    |      |       |      |       |

The rule of thumb: **major = Java version + 44**. Check a class with `javap -v MyClass.class | grep major`. Scala 3.8+ targets Java 17 (major 61) at minimum.

> [!TIP]
> To read or generate class files from code, use the **Class-File API** (`java.lang.classfile`, final in Java 24) instead of ASM: it is part of the JDK and always supports the latest class file version.

## Example: Putting It All Together

```scala
def add(a: Int, b: Int): Int = a + b
```

Compiles to:
```text
  0: iload_1       // Push 'a' from slot 1
  1: iload_2       // Push 'b' from slot 2
  2: iadd          // Pop both, push sum
  3: ireturn       // Return the int on top of stack
```

```scala
def greet(name: String): String = s"Hello, $name!"
```

Compiles to (Scala 3.9, as shown by `javap -c`):
```text
  0: aload_1                                   // Push 'name'
  1: invokedynamic makeConcatWithConstants     // String concatenation via a bootstrap method
  6: areturn                                   // Return the String
```

```scala
lazy val config: String = loadConfig()
```

Since Scala 3.8, the lazy val's state lives in a `volatile` field updated through a static `VarHandle` (the class initializer calls `MethodHandles.lookup().findVarHandle(...)`), and the initializing thread claims it with `VarHandle.compareAndSet` instead of `sun.misc.Unsafe`.
