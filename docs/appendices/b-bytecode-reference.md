# Appendix B — Bytecode Instruction Reference

[← Previous: JVM Flags](a-jvm-flags.md) · [Next: Glossary →](c-glossary.md)

---

JVM bytecode has about 200 instructions. Here they are, grouped by category. Each instruction is one byte (the "opcode"), optionally followed by operands.

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
| `ldc <index>`                      | Push constant from pool (int, float, String, Class) |
| `ldc_w <index>`                    | Wide index version of ldc                           |
| `ldc2_w <index>`                   | Push long or double from constant pool              |
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
| `invokevirtual`                                       | Instance methods (virtual dispatch via vtable)        |
| `invokeinterface`                                     | Interface methods (dispatch via itable)               |
| `invokespecial`                                       | Constructors, `super` calls, private methods          |
| `invokestatic`                                        | Static methods                                        |
| `invokedynamic`                                       | Bootstrap-linked calls (lambdas, string concat, etc.) |
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

## Exception Handling

| Opcode            | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `athrow`          | Throw exception                                                   |
| (exception table) | Not an opcode — try/catch is encoded as a table in the class file |

```
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

`synchronized` blocks compile to `monitorenter` / `monitorexit` pairs. `synchronized` methods are flagged in the method's access flags instead.

## Example: Putting It All Together

```scala
def add(a: Int, b: Int): Int = a + b
```

Compiles to:
```
  0: iload_1       // Push 'a' from slot 1
  1: iload_2       // Push 'b' from slot 2
  2: iadd          // Pop both, push sum
  3: ireturn       // Return the int on top of stack
```

```scala
def greet(name: String): String = s"Hello, $name!"
```

Compiles to (simplified):
```
  0: aload_1                            // Push 'name'
  1: invokedynamic makeConcatWithConstants  // String template via bootstrap
  6: areturn                            // Return the String
```

---

[← Previous: JVM Flags](a-jvm-flags.md) · [Next: Glossary →](c-glossary.md)
