// A bytecode interpreter for compiled programs: frames with local variables
// and an operand stack, executing one instruction per step(), like the
// HotSpot interpreter does (minus the speed). Hooks let the 3D world react to
// calls, returns, allocations, output, loop iterations and exceptions.

import { parseDescriptor, type Instr, type MethodInfo, type Program } from './bytecode';

export type Value = number | string | null | VmRef;
export type VmRef = VmObject | VmArray;

export interface VmObject {
  kind: 'object';
  id: number;
  cls: string;
  /** Records print as `Point[x=1, y=2]`. */
  isRecord: boolean;
  fields: Record<string, Value>;
}

export interface VmArray {
  kind: 'array';
  id: number;
  elem: 'int' | 'ref';
  /** Element type name, e.g. 'int' or 'Node' (for printing). */
  elemType: string;
  data: Value[];
}

export interface VmFrame {
  /** Unique, never reused. */
  id: number;
  method: MethodInfo;
  /** Index into method.code of the next instruction. */
  pc: number;
  locals: Value[];
  stack: Value[];
}

export interface VmHooks {
  /** A frame was pushed; `depth` is the new number of frames. */
  call?(m: MethodInfo, depth: number): void;
  /** A frame is being popped; `depth` is the number of frames before the pop. */
  ret?(m: MethodInfo, depth: number): void;
  alloc?(ref: VmRef, sizeBytes: number): void;
  /** Text written to System.out; println calls end with '\n'. */
  print?(text: string): void;
  /** A backwards jump was taken: one loop iteration (the JIT counts these). */
  backEdge?(m: MethodInfo): void;
  throw?(name: string, message: string): void;
}

export type VmState = 'ready' | 'running' | 'finished' | 'crashed';

export interface VmError {
  name: string;
  message: string;
  line: number;
}

/** Thrown inside step() and turned into a crash. */
class JavaException extends Error {
  constructor(
    readonly javaName: string,
    message: string,
  ) {
    super(message);
  }
}

/** What an instruction needs at run time, resolved once when the VM starts. */
interface Link {
  method?: MethodInfo;
  /** Number of arguments popped (receiver included for instance calls). */
  argc: number;
  returns: boolean;
  /** Parameter descriptors (for println and string concatenation formatting). */
  params: string[];
  fieldKey?: string;
}

const round8 = (n: number) => Math.ceil(n / 8) * 8;
/** Compact object headers (JDK 27): 8 bytes; ints and compressed references: 4 bytes. */
export const objectSize = (fields: number) => round8(8 + 4 * fields);
export const arraySize = (length: number) => round8(8 + 4 + 4 * length);

export function formatValue(v: Value): string {
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'string') return String(v);
  if (v.kind === 'array') return `${v.elemType}[${v.data.length}]`;
  if (v.isRecord) return `${v.cls}[${Object.entries(v.fields).map(([k, x]) => `${k}=${formatValue(x)}`).join(', ')}]`;
  return `${v.cls}@${v.id.toString(16)}`;
}

/** Formats a value as its static type says: an int typed Z prints as true/false. */
const formatAs = (v: Value, desc: string) => (desc === 'Z' ? (v ? 'true' : 'false') : formatValue(v));

export class Vm {
  readonly frames: VmFrame[] = [];
  state: VmState = 'ready';
  executed = 0;
  readonly output: string[] = [];
  error: VmError | null = null;

  private readonly links: Link[][];
  private readonly methodsByKey = new Map<string, MethodInfo>();
  private readonly statics = new Map<string, Value>();
  private readonly fieldDefaults = new Map<string, { name: string; ref: boolean }[]>();
  private readonly records = new Set<string>();
  private readonly maxDepth: number;
  private nextFrameId = 1;
  private nextObjectId = 1;
  private partialLine = '';

  constructor(
    readonly program: Program,
    private readonly hooks: VmHooks = {},
    opts: { maxDepth?: number } = {},
  ) {
    this.maxDepth = opts.maxDepth ?? 44;
    for (const m of program.methods) this.methodsByKey.set(`${m.owner}.${m.name}:${m.descriptor}`, m);
    for (const c of program.classes) {
      if (c.isRecord) this.records.add(c.name);
      this.fieldDefaults.set(
        c.name,
        c.fields.filter((f) => !f.isStatic).map((f) => ({ name: f.name, ref: f.type !== 'int' && f.type !== 'boolean' })),
      );
      for (const f of c.fields) if (f.isStatic) this.statics.set(`${c.name}.${f.name}`, f.type === 'int' || f.type === 'boolean' ? 0 : null);
    }
    this.links = program.methods.map((m) => m.code.map((i) => this.link(i)));

    // The launcher: main(String[] args), then static initialisers on top so they run first.
    const main = program.methods[program.main];
    const args: VmArray = { kind: 'array', id: this.nextObjectId++, elem: 'ref', elemType: 'String', data: [] };
    this.push(main, [args]);
    for (const m of program.methods) if (m.name === '<clinit>') this.push(m, []);
  }

  get current(): { frame: VmFrame; instr: Instr } | null {
    const frame = this.frames[this.frames.length - 1];
    if (!frame || this.state === 'finished' || this.state === 'crashed') return null;
    return { frame, instr: frame.method.code[frame.pc] };
  }

  get depth(): number {
    return this.frames.length;
  }

  /** Executes exactly one instruction. Returns false once finished or crashed. */
  step(): boolean {
    if (this.state === 'finished' || this.state === 'crashed') return false;
    this.state = 'running';
    const f = this.frames[this.frames.length - 1];
    const index = f.pc;
    const instr = f.method.code[index];
    try {
      f.pc++;
      this.executed++;
      this.exec(f, instr, this.links[f.method.id][index], index);
    } catch (e) {
      if (!(e instanceof JavaException)) throw e;
      this.state = 'crashed';
      this.error = { name: e.javaName, message: e.message, line: instr.line };
      this.hooks.throw?.(e.javaName, e.message);
      return false;
    }
    if (this.frames.length === 0) {
      this.state = 'finished';
      if (this.partialLine) this.output.push(this.partialLine);
      this.partialLine = '';
      return false;
    }
    return true;
  }

  /** Runs until the program ends or `budget` instructions have run. */
  run(budget = Infinity): VmState {
    for (let i = 0; i < budget && this.step(); i++);
    return this.state;
  }

  /** GC roots: references held in locals and operand stacks, and static fields. */
  roots(): VmRef[] {
    const out: VmRef[] = [];
    const add = (v: Value) => {
      if (v !== null && typeof v === 'object') out.push(v);
    };
    for (const f of this.frames) {
      f.locals.forEach(add);
      f.stack.forEach(add);
    }
    this.statics.forEach(add);
    return out;
  }

  /** Everything reachable from the roots, following fields and array elements. */
  reachable(): Set<VmRef> {
    const seen = new Set<VmRef>();
    const todo = this.roots();
    while (todo.length) {
      const r = todo.pop()!;
      if (seen.has(r)) continue;
      seen.add(r);
      const children = r.kind === 'array' ? r.data : Object.values(r.fields);
      for (const c of children) if (c !== null && typeof c === 'object' && !seen.has(c)) todo.push(c);
    }
    return seen;
  }

  // ------------------------------------------------------------- internals

  private link(i: Instr): Link {
    const [a, b, c] = i.operands;
    switch (i.op) {
      case 'invokestatic':
      case 'invokevirtual':
      case 'invokespecial': {
        const { params, ret } = parseDescriptor(String(c));
        const method = this.methodsByKey.get(`${a}.${b}:${c}`);
        return { method, argc: params.length + (i.op === 'invokestatic' ? 0 : 1), returns: ret !== 'V', params };
      }
      case 'invokedynamic':
        return { argc: parseDescriptor(String(b)).params.length, returns: true, params: parseDescriptor(String(b)).params };
      case 'getfield':
      case 'putfield':
      case 'getstatic':
      case 'putstatic':
        return { argc: 0, returns: false, params: [], fieldKey: i.op.endsWith('static') ? `${a}.${b}` : String(b) };
      default:
        return { argc: 0, returns: false, params: [] };
    }
  }

  private push(method: MethodInfo, args: Value[]): void {
    if (this.frames.length >= this.maxDepth) throw new JavaException('StackOverflowError', `the stack is full (${this.maxDepth} frames in this toy JVM)`);
    const locals: Value[] = new Array(Math.max(method.maxLocals, args.length)).fill(0);
    args.forEach((v, i) => (locals[i] = v));
    this.frames.push({ id: this.nextFrameId++, method, pc: 0, locals, stack: [] });
    this.hooks.call?.(method, this.frames.length);
  }

  private pop(value?: Value): void {
    const f = this.frames[this.frames.length - 1];
    this.hooks.ret?.(f.method, this.frames.length);
    this.frames.pop();
    const caller = this.frames[this.frames.length - 1];
    if (caller && value !== undefined) caller.stack.push(value);
  }

  private write(text: string): void {
    this.hooks.print?.(text);
    const lines = (this.partialLine + text).split('\n');
    this.partialLine = lines.pop()!;
    this.output.push(...lines);
  }

  private newObject(cls: string): VmObject {
    const fields: Record<string, Value> = {};
    const defs = this.fieldDefaults.get(cls) ?? [];
    for (const d of defs) fields[d.name] = d.ref ? null : 0;
    const o: VmObject = { kind: 'object', id: this.nextObjectId++, cls, isRecord: this.records.has(cls), fields };
    this.hooks.alloc?.(o, objectSize(defs.length));
    return o;
  }

  private newArray(elem: 'int' | 'ref', elemType: string, length: number): VmArray {
    if (length < 0) throw new JavaException('NegativeArraySizeException', String(length));
    const a: VmArray = { kind: 'array', id: this.nextObjectId++, elem, elemType, data: new Array(length).fill(elem === 'int' ? 0 : null) };
    this.hooks.alloc?.(a, arraySize(length));
    return a;
  }

  private jump(f: VmFrame, instr: Instr, from: number): void {
    const target = instr.target!;
    f.pc = target;
    if (target <= from) this.hooks.backEdge?.(f.method);
  }

  private obj(v: Value, what: string): VmObject {
    if (v === null) throw new JavaException('NullPointerException', `Cannot ${what} because the value is null`);
    return v as VmObject;
  }

  private arr(v: Value, what: string): VmArray {
    if (v === null) throw new JavaException('NullPointerException', `Cannot ${what} because the array is null`);
    return v as VmArray;
  }

  private checkIndex(a: VmArray, i: number): void {
    if (i < 0 || i >= a.data.length) throw new JavaException('ArrayIndexOutOfBoundsException', `Index ${i} out of bounds for length ${a.data.length}`);
  }

  private exec(f: VmFrame, instr: Instr, link: Link, index: number): void {
    const s = f.stack;
    const op = instr.op;
    const pop = () => s.pop() as Value;
    const popInt = () => s.pop() as number;
    switch (op) {
      case 'iconst_m1':
        s.push(-1);
        return;
      case 'iconst_0':
      case 'iconst_1':
      case 'iconst_2':
      case 'iconst_3':
      case 'iconst_4':
      case 'iconst_5':
        s.push(op.charCodeAt(7) - 48);
        return;
      case 'aconst_null':
        s.push(null);
        return;
      case 'bipush':
      case 'sipush':
      case 'ldc':
        s.push(instr.operands[0]);
        return;
      case 'iload':
      case 'aload':
        s.push(f.locals[instr.operands[0] as number]);
        return;
      case 'iload_0':
      case 'iload_1':
      case 'iload_2':
      case 'iload_3':
      case 'aload_0':
      case 'aload_1':
      case 'aload_2':
      case 'aload_3':
        s.push(f.locals[op.charCodeAt(6) - 48]);
        return;
      case 'istore':
      case 'astore':
        f.locals[instr.operands[0] as number] = pop();
        return;
      case 'istore_0':
      case 'istore_1':
      case 'istore_2':
      case 'istore_3':
      case 'astore_0':
      case 'astore_1':
      case 'astore_2':
      case 'astore_3':
        f.locals[op.charCodeAt(7) - 48] = pop();
        return;
      case 'iinc': {
        const slot = instr.operands[0] as number;
        f.locals[slot] = ((f.locals[slot] as number) + (instr.operands[1] as number)) | 0;
        return;
      }
      case 'iadd':
      case 'isub':
      case 'imul':
      case 'idiv':
      case 'irem': {
        const b = popInt();
        const a = popInt();
        if ((op === 'idiv' || op === 'irem') && b === 0) throw new JavaException('ArithmeticException', '/ by zero');
        s.push(op === 'iadd' ? (a + b) | 0 : op === 'isub' ? (a - b) | 0 : op === 'imul' ? Math.imul(a, b) : op === 'idiv' ? (a / b) | 0 : a % b | 0);
        return;
      }
      case 'ineg':
        s.push(-popInt() | 0);
        return;
      case 'goto':
        return this.jump(f, instr, index);
      case 'ifeq':
      case 'ifne':
      case 'iflt':
      case 'ifge':
      case 'ifgt':
      case 'ifle': {
        const v = popInt();
        if (compare(op.slice(2), v, 0)) this.jump(f, instr, index);
        return;
      }
      case 'if_icmpeq':
      case 'if_icmpne':
      case 'if_icmplt':
      case 'if_icmpge':
      case 'if_icmpgt':
      case 'if_icmple': {
        const b = popInt();
        const a = popInt();
        if (compare(op.slice(7), a, b)) this.jump(f, instr, index);
        return;
      }
      case 'if_acmpeq':
      case 'if_acmpne': {
        const b = pop();
        const a = pop();
        if ((a === b) === (op === 'if_acmpeq')) this.jump(f, instr, index);
        return;
      }
      case 'ifnull':
      case 'ifnonnull':
        if ((pop() === null) === (op === 'ifnull')) this.jump(f, instr, index);
        return;
      case 'ireturn':
      case 'areturn':
        return this.pop(pop());
      case 'return':
        return this.pop();
      case 'dup':
        s.push(s[s.length - 1]);
        return;
      case 'dup_x1':
        s.splice(s.length - 2, 0, s[s.length - 1]);
        return;
      case 'dup_x2':
        s.splice(s.length - 3, 0, s[s.length - 1]);
        return;
      case 'dup2':
        s.push(s[s.length - 2], s[s.length - 1]);
        return;
      case 'pop':
        s.pop();
        return;
      case 'new':
        s.push(this.newObject(String(instr.operands[0])));
        return;
      case 'newarray':
        s.push(this.newArray('int', 'int', popInt()));
        return;
      case 'anewarray': {
        const t = String(instr.operands[0]).replace('java/lang/', '');
        s.push(this.newArray('ref', t, popInt()));
        return;
      }
      case 'arraylength':
        s.push(this.arr(pop(), 'read the array length').data.length);
        return;
      case 'iaload':
      case 'aaload': {
        const i = popInt();
        const a = this.arr(pop(), 'load from an array');
        this.checkIndex(a, i);
        s.push(a.data[i]);
        return;
      }
      case 'iastore':
      case 'aastore': {
        const v = pop();
        const i = popInt();
        const a = this.arr(pop(), 'store into an array');
        this.checkIndex(a, i);
        a.data[i] = v;
        return;
      }
      case 'getfield': {
        const o = this.obj(pop(), `read field "${link.fieldKey}"`);
        s.push(o.fields[link.fieldKey!]);
        return;
      }
      case 'putfield': {
        const v = pop();
        this.obj(pop(), `assign field "${link.fieldKey}"`).fields[link.fieldKey!] = v;
        return;
      }
      case 'getstatic':
        s.push(link.fieldKey === 'java/lang/System.out' ? 'System.out' : (this.statics.get(link.fieldKey!) ?? null));
        return;
      case 'putstatic':
        this.statics.set(link.fieldKey!, pop());
        return;
      case 'invokedynamic': {
        const args = s.splice(s.length - link.argc, link.argc);
        let k = 0;
        const recipe = String(instr.operands[2]);
        s.push(recipe.replace(/\u0001/g, () => formatAs(args[k], link.params[k++])));
        return;
      }
      case 'invokestatic':
      case 'invokevirtual':
      case 'invokespecial':
        return this.invoke(f, instr, link);
      default:
        throw new Error(`Unsupported instruction ${op}`);
    }
  }

  private invoke(f: VmFrame, instr: Instr, link: Link): void {
    const s = f.stack;
    const args = s.splice(s.length - link.argc, link.argc);
    const [owner, name] = instr.operands as string[];
    if (owner === 'java/io/PrintStream') {
      const text = args.length > 1 ? formatAs(args[1], link.params[0]) : '';
      this.write(name === 'println' ? `${text}\n` : text);
      return;
    }
    if (owner === 'java/lang/Math') {
      const [a, b] = args as number[];
      s.push(name === 'max' ? Math.max(a, b) : name === 'min' ? Math.min(a, b) : Math.abs(a) | 0);
      return;
    }
    if (owner === 'java/lang/Object') return; // Object.<init> does nothing
    if (instr.op === 'invokevirtual') this.obj(args[0], `invoke "${owner}.${name}()"`);
    if (!link.method) throw new Error(`Unresolved method ${owner}.${name}`);
    this.push(link.method, args);
  }
}

function compare(cond: string, a: number, b: number): boolean {
  switch (cond) {
    case 'eq':
      return a === b;
    case 'ne':
      return a !== b;
    case 'lt':
      return a < b;
    case 'ge':
      return a >= b;
    case 'gt':
      return a > b;
    default:
      return a <= b;
  }
}
