// The compiled form: classes, methods and their bytecode, with real JVM
// instruction sizes and javap-like rendering. Also the Emitter the compiler
// uses to build a method's code, with labels and max-stack tracking.

export interface ClassInfo {
  name: string;
  isRecord: boolean;
  fields: { name: string; type: string; isStatic: boolean }[];
}

export interface Instr {
  /** Byte offset in the method, using real instruction sizes. */
  offset: number;
  /** javap mnemonic. */
  op: string;
  operands: (number | string)[];
  /** javap-like rendering, e.g. `if_icmpge 17` or `invokestatic Main.fib:(I)I`. */
  text: string;
  /** Source line, for highlighting. */
  line: number;
  /** For jumps: index (into `code`) of the target instruction. */
  target?: number;
}

export interface MethodInfo {
  id: number;
  owner: string;
  name: string;
  /** JVM descriptor, e.g. `(II)I`. */
  descriptor: string;
  isStatic: boolean;
  maxLocals: number;
  maxStack: number;
  /** Slot -> variable name (the last one to use the slot). */
  localNames: (string | null)[];
  code: Instr[];
}

export interface Program {
  classes: ClassInfo[];
  methods: MethodInfo[];
  /** Index into `methods` of `public static void main(String[] args)`. */
  main: number;
}

// ------------------------------------------------------------------ types

export const isArrayType = (t: string) => t.endsWith('[]');
export const elemType = (t: string) => t.slice(0, -2);
export const isRefType = (t: string) => t !== 'int' && t !== 'boolean' && t !== 'void';

/** JVM descriptor of a source type. */
export function descriptorOf(t: string): string {
  if (isArrayType(t)) return `[${descriptorOf(elemType(t))}`;
  switch (t) {
    case 'int':
      return 'I';
    case 'boolean':
      return 'Z';
    case 'void':
      return 'V';
    case 'String':
      return 'Ljava/lang/String;';
    default:
      return `L${t};`;
  }
}

export const methodDescriptor = (params: string[], ret: string) => `(${params.map(descriptorOf).join('')})${descriptorOf(ret)}`;

/** Splits a method descriptor into parameter descriptors and the return descriptor. */
export function parseDescriptor(desc: string): { params: string[]; ret: string } {
  const params: string[] = [];
  let i = 1;
  const one = (): string => {
    const start = i;
    while (desc[i] === '[') i++;
    if (desc[i] === 'L') i = desc.indexOf(';', i) + 1;
    else i++;
    return desc.slice(start, i);
  };
  while (desc[i] !== ')') params.push(one());
  i++;
  return { params, ret: one() };
}

// ------------------------------------------------------------------ sizes

const SIZE_3 = new Set([
  'sipush', 'iinc', 'goto', 'ifeq', 'ifne', 'iflt', 'ifge', 'ifgt', 'ifle', 'if_icmpeq', 'if_icmpne', 'if_icmplt', 'if_icmpge',
  'if_icmpgt', 'if_icmple', 'if_acmpeq', 'if_acmpne', 'ifnull', 'ifnonnull', 'invokestatic', 'invokevirtual', 'invokespecial',
  'new', 'getfield', 'putfield', 'getstatic', 'putstatic', 'anewarray',
]);
const SIZE_2 = new Set(['bipush', 'ldc', 'newarray', 'iload', 'istore', 'aload', 'astore']);

/** Size in bytes of an instruction, as in a real class file. */
export function instrSize(op: string): number {
  if (op === 'invokedynamic') return 5;
  if (SIZE_3.has(op)) return 3;
  if (SIZE_2.has(op)) return 2;
  return 1;
}

export const JUMPS = new Set([...SIZE_3].filter((op) => op.startsWith('if') || op === 'goto'));

/** How each fixed-shape instruction changes the operand stack depth. */
const STACK_EFFECT: Record<string, number> = {
  iconst_m1: 1, iconst_0: 1, iconst_1: 1, iconst_2: 1, iconst_3: 1, iconst_4: 1, iconst_5: 1, aconst_null: 1,
  bipush: 1, sipush: 1, ldc: 1, iload: 1, aload: 1, istore: -1, astore: -1,
  iadd: -1, isub: -1, imul: -1, idiv: -1, irem: -1, ineg: 0, iinc: 0,
  ifeq: -1, ifne: -1, iflt: -1, ifge: -1, ifgt: -1, ifle: -1, ifnull: -1, ifnonnull: -1,
  if_icmpeq: -2, if_icmpne: -2, if_icmplt: -2, if_icmpge: -2, if_icmpgt: -2, if_icmple: -2, if_acmpeq: -2, if_acmpne: -2,
  goto: 0, ireturn: -1, areturn: -1, return: 0, dup: 1, dup_x1: 1, dup_x2: 1, dup2: 2, pop: -1,
  new: 1, getfield: 0, putfield: -2, getstatic: 1, putstatic: -1, newarray: 0, anewarray: 0, arraylength: 0,
  iaload: -1, aaload: -1, iastore: -3, aastore: -3,
};

/** Short forms: iload_0..3 and friends. */
export function slotOp(base: 'iload' | 'istore' | 'aload' | 'astore', slot: number): [string, number[]] {
  return slot <= 3 ? [`${base}_${slot}`, []] : [base, [slot]];
}

const baseOf = (op: string) => op.replace(/_\d$/, '');

// ------------------------------------------------------------------ emitter

export class Label {
  /** Index of the instruction this label points at, once placed. */
  index = -1;
  /** Stack depth expected at the label (set by the first jump to it). */
  depth: number | undefined;
  used = false;
}

interface Draft {
  op: string;
  operands: (number | string)[];
  line: number;
  label?: Label;
}

export class Emitter {
  private readonly code: Draft[] = [];
  private depth = 0;
  maxStack = 0;
  line = 1;
  /** False right after an unconditional jump or return: the next code is only reachable through a label. */
  private reachable = true;

  /** Emits an instruction. `effect` overrides the stack effect (for invokes and invokedynamic). */
  emit(op: string, operands: (number | string)[] = [], effect?: number): void {
    const e = effect ?? STACK_EFFECT[baseOf(op)] ?? STACK_EFFECT[op];
    if (e === undefined) throw new Error(`No stack effect for ${op}`);
    this.code.push({ op, operands, line: this.line });
    this.move(e);
    if (op === 'goto' || op.endsWith('return')) this.reachable = false;
  }

  jump(op: string, label: Label): void {
    this.code.push({ op, operands: [], line: this.line, label });
    this.move(STACK_EFFECT[op]);
    label.used = true;
    label.depth ??= this.depth;
    if (op === 'goto') this.reachable = false;
  }

  place(label: Label): void {
    label.index = this.code.length;
    if (label.depth !== undefined) this.depth = label.depth;
    this.reachable = true;
  }

  /** Whether code emitted now could run (javac drops dead gotos after a return). */
  get live(): boolean {
    return this.reachable;
  }

  private move(delta: number): void {
    this.depth += delta;
    this.maxStack = Math.max(this.maxStack, this.depth);
  }

  /**
   * Resolves labels into offsets. With `strict` off (the method already has
   * compile errors), a jump to nowhere is tolerated instead of thrown.
   */
  finish(strict = true): Instr[] {
    let offset = 0;
    const out: Instr[] = this.code.map((d) => {
      const instr: Instr = { offset, op: d.op, operands: d.operands, text: '', line: d.line };
      offset += instrSize(d.op);
      return instr;
    });
    this.code.forEach((d, i) => {
      if (d.label) {
        if (d.label.index < 0 || d.label.index >= out.length) {
          if (strict) throw new Error(`Jump to a label that has no instruction (${d.op})`);
          return;
        }
        out[i].target = d.label.index;
        out[i].operands = [out[d.label.index].offset];
      }
      out[i].text = render(out[i]);
    });
    return out;
  }
}

function render(i: Instr): string {
  const [a, b, c] = i.operands;
  switch (i.op) {
    case 'invokestatic':
    case 'invokevirtual':
    case 'invokespecial':
    case 'getfield':
    case 'putfield':
    case 'getstatic':
    case 'putstatic':
      return `${i.op} ${a}.${b}:${c}`;
    case 'invokedynamic':
      return `${i.op} ${a}:${b}`;
    case 'iinc':
      return `iinc ${a}, ${b}`;
    case 'ldc':
      return typeof a === 'string' ? `ldc "${a.replace(/\n/g, '\\n')}"` : `ldc ${a}`;
    default:
      return i.operands.length ? `${i.op} ${i.operands.join(' ')}` : i.op;
  }
}
