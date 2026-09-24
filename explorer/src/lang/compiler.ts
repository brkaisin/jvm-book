// Compiles the Java subset to JVM bytecode, the way javac would: constants
// with their short forms, conditions as inverted jumps, `iinc` for counters,
// `invokedynamic makeConcatWithConstants` for string concatenation.
// Type checking happens along the way, with friendly error messages.

import type { AssignOp, BinaryOp, ClassDecl, CompilationUnit, Expr, MethodDecl, Pos, Stmt } from './ast';
import {
  Emitter,
  Label,
  descriptorOf,
  elemType,
  isArrayType,
  isRefType,
  methodDescriptor,
  slotOp,
  type ClassInfo,
  type MethodInfo,
  type Program,
} from './bytecode';
import { SourceError } from './lexer';
import { parse } from './parser';

export interface CompileError {
  /** 1-based. */
  line: number;
  col: number;
  message: string;
}

export type CompileResult = { ok: true; program: Program } | { ok: false; errors: CompileError[] };

export function compile(source: string): CompileResult {
  let unit: CompilationUnit;
  try {
    unit = parse(source);
  } catch (e) {
    if (e instanceof SourceError) return { ok: false, errors: [{ line: e.line, col: e.col, message: e.message }] };
    throw e;
  }
  return new Compiler(unit).run();
}

// ------------------------------------------------------------------ symbols

interface FieldSym {
  owner: string;
  name: string;
  type: string;
  isStatic: boolean;
}

type Synthetic = 'recordCtor' | 'accessor' | 'defaultCtor' | 'clinit';

interface MethodSym {
  owner: string;
  name: string;
  params: string[];
  paramNames: string[];
  ret: string;
  isStatic: boolean;
  descriptor: string;
  info: MethodInfo;
  decl?: MethodDecl;
  synthetic?: Synthetic;
}

interface ClassSym {
  decl: ClassDecl;
  name: string;
  fields: Map<string, FieldSym>;
  methods: Map<string, MethodSym>;
  ctor: MethodSym | null;
}

const BUILTIN_TYPES = new Set(['int', 'boolean', 'String']);
const ARITH: Partial<Record<BinaryOp | AssignOp, string>> = {
  '+': 'iadd', '-': 'isub', '*': 'imul', '/': 'idiv', '%': 'irem',
  '+=': 'iadd', '-=': 'isub', '*=': 'imul', '/=': 'idiv', '%=': 'irem',
};
const COND: Record<string, string> = { '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge', '==': 'eq', '!=': 'ne' };
const INVERSE: Record<string, string> = { lt: 'ge', ge: 'lt', gt: 'le', le: 'gt', eq: 'ne', ne: 'eq' };
const MATH: Record<string, number> = { max: 2, min: 2, abs: 1 };

const fail = (message: string, at: Pos): never => {
  throw new SourceError(message, at.line, at.col);
};

// ------------------------------------------------------------------ compiler

class Compiler {
  readonly classes = new Map<string, ClassSym>();
  readonly methods: MethodInfo[] = [];
  readonly errors: CompileError[] = [];

  constructor(private readonly unit: CompilationUnit) {}

  run(): CompileResult {
    this.guard(() => this.declare());
    if (this.errors.length) return { ok: false, errors: this.errors };
    for (const cls of this.classes.values()) for (const m of this.allMethods(cls)) new MethodGen(this, cls, m).generate();
    const main = this.findMain();
    if (this.errors.length) return { ok: false, errors: this.sortedErrors() };
    const classes: ClassInfo[] = [...this.classes.values()].map((c) => ({
      name: c.name,
      isRecord: c.decl.isRecord,
      fields: [...c.fields.values()].map((f) => ({ name: f.name, type: f.type, isStatic: f.isStatic })),
    }));
    return { ok: true, program: { classes, methods: this.methods, main: main! } };
  }

  error(e: unknown): void {
    if (!(e instanceof SourceError)) throw e;
    if (!this.errors.some((x) => x.line === e.line && x.message === e.message)) this.errors.push({ line: e.line, col: e.col, message: e.message });
  }

  guard(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.error(e);
    }
  }

  private sortedErrors(): CompileError[] {
    return [...this.errors].sort((a, b) => a.line - b.line || a.col - b.col);
  }

  checkType(t: string, at: Pos, allowVoid = false): void {
    if (t === 'void') {
      if (!allowVoid) fail(`'void' is not a type for values`, at);
      return;
    }
    const base = t.replace(/(\[\])+$/, '');
    if (base === 'void' || (!BUILTIN_TYPES.has(base) && !this.classes.has(base)))
      fail(base === 'long' || base === 'double' || base === 'char' ? `The type '${base}' is not supported here: use int` : `Unknown type '${base}'`, at);
    if (base === 'boolean' && t !== base) fail('boolean arrays are not supported here: use int[]', at);
  }

  private allMethods(cls: ClassSym): MethodSym[] {
    return [...(cls.ctor ? [cls.ctor] : []), ...cls.methods.values()];
  }

  private newMethod(owner: string, name: string, params: string[], paramNames: string[], ret: string, isStatic: boolean): MethodSym {
    const descriptor = methodDescriptor(params, ret);
    const info: MethodInfo = { id: this.methods.length, owner, name, descriptor, isStatic, maxLocals: 0, maxStack: 0, localNames: [], code: [] };
    this.methods.push(info);
    return { owner, name, params, paramNames, ret, isStatic, descriptor, info };
  }

  /** First pass: every class, field and method signature. */
  private declare(): void {
    for (const decl of this.unit.classes) {
      if (this.classes.has(decl.name)) fail(`Class ${decl.name} is defined twice`, decl);
      if (BUILTIN_TYPES.has(decl.name) || decl.name === 'Math' || decl.name === 'System') fail(`${decl.name} is a built-in name`, decl);
      this.classes.set(decl.name, { decl, name: decl.name, fields: new Map(), methods: new Map(), ctor: null });
    }
    if (this.classes.size === 0) fail('Write at least one class, with a main method', { line: 1, col: 1 });
    for (const cls of this.classes.values()) this.guard(() => this.declareMembers(cls));
  }

  private declareMembers(cls: ClassSym): void {
    const d = cls.decl;
    const addField = (name: string, type: string, isStatic: boolean, at: Pos) => {
      this.checkType(type, at);
      if (cls.fields.has(name)) fail(`Field ${name} is defined twice in ${cls.name}`, at);
      cls.fields.set(name, { owner: cls.name, name, type, isStatic });
    };
    for (const c of d.components) addField(c.name, c.type, false, c);
    for (const f of d.fields) addField(f.name, f.type, f.isStatic, f);

    for (const m of d.methods)
      this.guard(() => {
        for (const p of m.params) this.checkType(p.type, p);
        this.checkType(m.ret, m, true);
        const params = m.params.map((p) => p.type);
        const names = m.params.map((p) => p.name);
        if (m.isCtor) {
          if (cls.ctor) fail(`Only one constructor per class is supported here`, m);
          cls.ctor = { ...this.newMethod(cls.name, '<init>', params, names, 'void', false), decl: m };
        } else {
          if (cls.methods.has(m.name)) fail(`Method ${m.name} is defined twice in ${cls.name} (overloading is not supported here)`, m);
          cls.methods.set(m.name, { ...this.newMethod(cls.name, m.name, params, names, m.ret, m.isStatic), decl: m });
        }
      });

    if (d.isRecord) {
      if (!cls.ctor) {
        const types = d.components.map((c) => c.type);
        cls.ctor = { ...this.newMethod(cls.name, '<init>', types, d.components.map((c) => c.name), 'void', false), synthetic: 'recordCtor' };
      }
      for (const c of d.components)
        if (!cls.methods.has(c.name)) cls.methods.set(c.name, { ...this.newMethod(cls.name, c.name, [], [], c.type, false), synthetic: 'accessor' });
    } else if (!cls.ctor) cls.ctor = { ...this.newMethod(cls.name, '<init>', [], [], 'void', false), synthetic: 'defaultCtor' };

    if (d.fields.some((f) => f.isStatic && f.init)) cls.methods.set('<clinit>', { ...this.newMethod(cls.name, '<clinit>', [], [], 'void', true), synthetic: 'clinit' });
  }

  private findMain(): number | null {
    const candidates = [...this.classes.values()].map((c) => c.methods.get('main')).filter((m): m is MethodSym => !!m);
    const main = candidates.find((m) => m.isStatic && m.ret === 'void' && m.params.length === 1 && m.params[0] === 'String[]');
    if (!main) {
      const at = candidates[0]?.decl ?? { line: 1, col: 1 };
      this.error(new SourceError('No main method found: add `public static void main(String[] args)`', at.line, at.col));
      return null;
    }
    return main.info.id;
  }
}

// ------------------------------------------------------------------ one method

interface Local {
  name: string;
  type: string;
  slot: number;
}

/** Where an assignment goes: the stack shape differs for locals, fields and array elements. */
interface LValue {
  type: string;
  /** Pushes what the store needs below the value (object, or array + index). */
  prepare(): void;
  /** Duplicates what prepare() pushed (for read-modify-write). */
  dupPrepared(): void;
  /** Reads the current value (consumes one copy of the prepared operands). */
  get(): void;
  /** Stores the value on top (consumes the prepared operands). */
  set(): void;
  /** Duplicates the value under the prepared operands (for assignments used as expressions). */
  dupValue(): void;
  local?: Local;
}

class MethodGen {
  private readonly em = new Emitter();
  private readonly scopes: Map<string, Local>[] = [new Map()];
  private nextSlot = 0;
  private maxLocals = 0;
  private readonly localNames: (string | null)[] = [];
  private readonly loops: { brk: Label; cont: Label }[] = [];
  private readonly isStatic: boolean;

  constructor(
    private readonly c: Compiler,
    private readonly cls: ClassSym,
    private readonly m: MethodSym,
  ) {
    this.isStatic = m.isStatic;
    if (!m.isStatic) this.declareLocal('this', cls.name, { line: 0, col: 0 }, true);
    m.params.forEach((t, i) => this.declareLocal(m.paramNames[i], t, m.decl?.params[i] ?? { line: 0, col: 0 }, true));
  }

  generate(): void {
    const { m, em } = this;
    em.line = m.decl?.line ?? this.cls.decl.line;
    this.c.guard(() => {
      switch (m.synthetic) {
        case 'recordCtor':
          this.superInit();
          this.cls.decl.components.forEach((comp) => {
            em.emit(...slotOp('aload', 0));
            this.load(this.lookup(comp.name)!);
            em.emit('putfield', [this.cls.name, comp.name, descriptorOf(comp.type)]);
          });
          em.emit('return');
          break;
        case 'accessor':
          em.emit(...slotOp('aload', 0));
          em.emit('getfield', [this.cls.name, m.name, descriptorOf(m.ret)]);
          em.emit(isRefType(m.ret) ? 'areturn' : 'ireturn');
          break;
        case 'defaultCtor':
          this.superInit();
          this.fieldInits(false);
          em.emit('return');
          break;
        case 'clinit':
          this.fieldInits(true);
          em.emit('return');
          break;
        default:
          this.userMethod(m.decl!);
      }
    });
    m.info.code = em.finish(this.c.errors.length === 0);
    m.info.maxStack = em.maxStack;
    m.info.maxLocals = this.maxLocals;
    m.info.localNames = this.localNames;
  }

  private userMethod(d: MethodDecl): void {
    if (d.isCtor) {
      this.superInit();
      this.fieldInits(false);
    }
    this.block(d.body.body);
    if (canComplete(d.body)) {
      this.em.line = d.endLine;
      if (d.ret !== 'void') fail(`Method ${d.name} must return a ${d.ret}: add a return statement`, { line: d.endLine, col: 1 });
      this.em.emit('return');
    }
  }

  /** Every constructor starts by calling Object's. */
  private superInit(): void {
    this.em.emit(...slotOp('aload', 0));
    this.em.emit('invokespecial', ['java/lang/Object', '<init>', '()V'], -1);
  }

  private fieldInits(statics: boolean): void {
    for (const f of this.cls.decl.fields) {
      if (f.isStatic !== statics || !f.init) continue;
      this.em.line = f.line;
      if (!statics) this.em.emit(...slotOp('aload', 0));
      this.expectType(this.value(f.init), f.type, f.init);
      this.em.emit(statics ? 'putstatic' : 'putfield', [this.cls.name, f.name, descriptorOf(f.type)]);
    }
  }

  // ------------------------------------------------------------- locals

  private declareLocal(name: string, type: string, at: Pos, param = false): Local {
    if (this.lookup(name) && name !== 'this') fail(`Variable ${name} is already defined here`, at);
    if (!param) this.c.checkType(type, at);
    const local = { name, type, slot: this.nextSlot++ };
    this.scopes[this.scopes.length - 1].set(name, local);
    this.localNames[local.slot] = name;
    this.maxLocals = Math.max(this.maxLocals, this.nextSlot);
    return local;
  }

  private lookup(name: string): Local | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const l = this.scopes[i].get(name);
      if (l) return l;
    }
    return undefined;
  }

  /** A block scope: javac reuses the slots of variables that went out of scope. */
  private scoped(fn: () => void): void {
    const saved = this.nextSlot;
    this.scopes.push(new Map());
    try {
      fn();
    } finally {
      this.scopes.pop();
      this.nextSlot = saved;
    }
  }

  private load(l: Local): void {
    this.em.emit(...slotOp(isRefType(l.type) ? 'aload' : 'iload', l.slot));
  }

  private store(l: Local): void {
    this.em.emit(...slotOp(isRefType(l.type) ? 'astore' : 'istore', l.slot));
  }

  // ------------------------------------------------------------- statements

  private block(stmts: Stmt[]): void {
    this.scoped(() => {
      for (const s of stmts) this.c.guard(() => this.stmt(s));
    });
  }

  private stmt(s: Stmt): void {
    const em = this.em;
    em.line = s.line;
    switch (s.kind) {
      case 'block':
        return this.block(s.body);
      case 'empty':
        return;
      case 'local': {
        let type = s.type;
        if (type === 'var') {
          if (!s.init) fail(`'var' needs an initial value, so the type can be inferred`, s);
          type = this.typeOf(s.init!);
          if (type === 'null' || type === 'void') fail(`Cannot infer a type for ${s.name} from this value`, s);
        }
        this.c.checkType(type, s);
        if (s.init) this.expectType(this.value(s.init), type, s.init);
        const local = this.declareLocal(s.name, type, s);
        if (s.init) this.store(local);
        return;
      }
      case 'if': {
        const elseL = new Label();
        const end = new Label();
        this.jumpIfFalse(s.cond, elseL);
        this.stmt(s.then);
        if (s.else) {
          if (em.live) em.jump('goto', end);
          em.place(elseL);
          this.stmt(s.else);
          em.place(end);
        } else em.place(elseL);
        return;
      }
      case 'while': {
        const cond = new Label();
        const exit = new Label();
        em.place(cond);
        this.jumpIfFalse(s.cond, exit);
        this.loop(exit, cond, () => this.stmt(s.body));
        em.line = s.line;
        em.jump('goto', cond);
        em.place(exit);
        return;
      }
      case 'for':
        return this.scoped(() => {
          for (const i of s.init) this.stmt(i);
          const cond = new Label();
          const update = new Label();
          const exit = new Label();
          em.line = s.line;
          em.place(cond);
          if (s.cond) this.jumpIfFalse(s.cond, exit);
          this.loop(exit, update, () => this.stmt(s.body));
          em.place(update);
          em.line = s.line;
          for (const u of s.update) this.effect(u);
          em.jump('goto', cond);
          em.place(exit);
        });
      case 'return': {
        const ret = this.m.ret;
        if (!s.value) {
          if (ret !== 'void') fail(`This method must return a ${ret}`, s);
          em.emit('return');
          return;
        }
        if (ret === 'void') fail(`A void method cannot return a value`, s);
        this.expectType(this.value(s.value), ret, s.value);
        em.emit(isRefType(ret) ? 'areturn' : 'ireturn');
        return;
      }
      case 'expr':
        return this.effect(s.expr);
      case 'break':
      case 'continue': {
        const loop = this.loops[this.loops.length - 1];
        if (!loop) fail(`'${s.kind}' outside of a loop`, s);
        em.jump('goto', s.kind === 'break' ? loop.brk : loop.cont);
        return;
      }
    }
  }

  private loop(brk: Label, cont: Label, body: () => void): void {
    this.loops.push({ brk, cont });
    try {
      body();
    } finally {
      this.loops.pop();
    }
  }

  /** An expression used as a statement: its value, if any, is discarded. */
  private effect(e: Expr): void {
    this.em.line = e.line;
    if (e.kind === 'assign') return this.assign(e, false);
    if (e.kind === 'incdec') return this.incdec(e, false);
    const t = this.value(e);
    if (t !== 'void') this.em.emit('pop');
  }

  // ------------------------------------------------------------- types

  private assignable(from: string, to: string): boolean {
    if (from === to) return true;
    if (from === 'null') return isRefType(to);
    return false;
  }

  private expectType(actual: string, expected: string, at: Pos): void {
    if (actual === 'void') fail(`This call returns nothing (void), so it has no value`, at);
    if (!this.assignable(actual, expected)) fail(`Type mismatch: expected ${expected} but this is ${actual === 'null' ? 'null' : `a ${actual}`}`, at);
  }

  /** The static type of an expression, without generating code. */
  private typeOf(e: Expr): string {
    switch (e.kind) {
      case 'int':
        return 'int';
      case 'bool':
        return 'boolean';
      case 'null':
        return 'null';
      case 'string':
        return 'String';
      case 'this':
        return this.cls.name;
      case 'name':
        return this.resolveName(e.name, e).type;
      case 'binary':
        if (e.op === '+' && (this.typeOf(e.left) === 'String' || this.typeOf(e.right) === 'String')) return 'String';
        return ARITH[e.op] ? 'int' : 'boolean';
      case 'unary':
        return e.op === '-' ? 'int' : 'boolean';
      case 'assign':
      case 'incdec':
        return this.typeOf(e.target);
      case 'call':
        return this.resolveCall(e).ret;
      case 'field':
        return this.resolveField(e).type;
      case 'index':
        return elemType(this.arrayType(e.array));
      case 'new':
        return e.cls;
      case 'newArray':
        return `${e.elem}[]`;
    }
  }

  private arrayType(e: Expr): string {
    const t = this.typeOf(e);
    if (!isArrayType(t)) fail(`This is a ${t}, not an array`, e);
    return t;
  }

  // ------------------------------------------------------------- resolution

  private resolveName(name: string, at: Pos): { type: string; local?: Local; field?: FieldSym } {
    const local = this.lookup(name);
    if (local) return { type: local.type, local };
    const field = this.cls.fields.get(name);
    if (field) {
      if (!field.isStatic && this.isStatic) fail(`${name} is an instance field: it cannot be used in the static method ${this.m.name}`, at);
      return { type: field.type, field };
    }
    if (this.c.classes.has(name) || name === 'Math' || name === 'System') fail(`${name} is a class, not a value`, at);
    return fail(`Unknown variable '${name}'`, at);
  }

  /** Is `e` a bare class name (for static access) rather than a value? */
  private className(e: Expr | null): string | null {
    if (!e || e.kind !== 'name' || this.lookup(e.name) || this.cls.fields.has(e.name)) return null;
    return this.c.classes.has(e.name) || e.name === 'Math' || e.name === 'System' ? e.name : null;
  }

  private resolveField(e: Extract<Expr, { kind: 'field' }>): { type: string; field?: FieldSym; arrayLength?: boolean; staticOwner?: string } {
    const owner = this.className(e.obj);
    if (owner) {
      if (owner === 'System' && e.name === 'out') return { type: 'PrintStream', staticOwner: owner };
      const f = this.c.classes.get(owner)?.fields.get(e.name);
      if (!f) fail(`Unknown field ${owner}.${e.name}`, e);
      if (!f!.isStatic) fail(`${e.name} is an instance field: use an object of ${owner}, not the class`, e);
      return { type: f!.type, field: f!, staticOwner: owner };
    }
    const t = this.typeOf(e.obj);
    if (isArrayType(t)) {
      if (e.name !== 'length') fail(`Arrays only have a 'length' field`, e);
      return { type: 'int', arrayLength: true };
    }
    const f = this.c.classes.get(t)?.fields.get(e.name);
    if (!f) fail(`Unknown field '${e.name}' in ${t}`, e);
    return { type: f!.type, field: f! };
  }

  private resolveCall(e: Extract<Expr, { kind: 'call' }>): { ret: string; kind: 'println' | 'math' | 'static' | 'virtual'; sym?: MethodSym } {
    const t = e.target;
    if (t?.kind === 'field' && this.className(t.obj) === 'System' && t.name === 'out') {
      if (e.name !== 'println' && e.name !== 'print') fail(`Only System.out.println and System.out.print are supported`, e);
      if (e.args.length > 1 || (e.name === 'print' && e.args.length === 0)) fail(`${e.name} takes one value`, e);
      return { ret: 'void', kind: 'println' };
    }
    const owner = this.className(t);
    if (owner === 'Math') {
      if (!(e.name in MATH)) fail(`Only Math.max, Math.min and Math.abs are supported`, e);
      return { ret: 'int', kind: 'math' };
    }
    if (owner === 'System') fail(`Only System.out.println is supported`, e);
    const clsName = t === null ? this.cls.name : (owner ?? this.typeOf(t));
    const cls = this.c.classes.get(clsName);
    if (!cls) fail(clsName === 'String' ? `String methods are not supported here` : `A ${clsName} has no methods`, e);
    const sym = cls!.methods.get(e.name);
    if (!sym || sym.name.startsWith('<')) fail(`Unknown method '${e.name}' in ${clsName}`, e);
    if (t === null && !sym!.isStatic && this.isStatic) fail(`${e.name} is an instance method: it cannot be called from the static method ${this.m.name}`, e);
    if (owner && !sym!.isStatic) fail(`${e.name} is an instance method: call it on an object, not on the class ${owner}`, e);
    return { ret: sym!.ret, kind: sym!.isStatic ? 'static' : 'virtual', sym: sym! };
  }

  private args(params: string[], args: Expr[], what: string, at: Pos): void {
    if (params.length !== args.length) fail(`${what} takes ${params.length} argument${params.length === 1 ? '' : 's'}, not ${args.length}`, at);
    args.forEach((a, i) => this.expectType(this.value(a), params[i], a));
  }

  // ------------------------------------------------------------- values

  private pushInt(v: number): void {
    const em = this.em;
    if (v >= -1 && v <= 5) em.emit(v === -1 ? 'iconst_m1' : `iconst_${v}`);
    else if (v >= -128 && v <= 127) em.emit('bipush', [v]);
    else if (v >= -32768 && v <= 32767) em.emit('sipush', [v]);
    else em.emit('ldc', [v]);
  }

  /** Generates code leaving the value of `e` on the stack; returns its type. */
  private value(e: Expr): string {
    const em = this.em;
    em.line = e.line;
    switch (e.kind) {
      case 'int':
        this.pushInt(e.value);
        return 'int';
      case 'bool':
        em.emit(e.value ? 'iconst_1' : 'iconst_0');
        return 'boolean';
      case 'null':
        em.emit('aconst_null');
        return 'null';
      case 'string':
        em.emit('ldc', [e.value]);
        return 'String';
      case 'this':
        if (this.isStatic) fail(`'this' does not exist in the static method ${this.m.name}`, e);
        em.emit(...slotOp('aload', 0));
        return this.cls.name;
      case 'name':
        return this.readLValue(e);
      case 'binary':
        return this.binary(e);
      case 'unary':
        if (e.op === '-') {
          this.expectType(this.value(e.expr), 'int', e.expr);
          em.emit('ineg');
          return 'int';
        }
        return this.materialize(e);
      case 'assign':
        this.assign(e, true);
        return this.typeOf(e.target);
      case 'incdec':
        this.incdec(e, true);
        return 'int';
      case 'call':
        return this.call(e);
      case 'field': {
        const r = this.resolveField(e);
        if (r.staticOwner === 'System') fail(`System.out can only be used to call println`, e);
        if (r.arrayLength) {
          this.value(e.obj);
          em.emit('arraylength');
          return 'int';
        }
        return this.readLValue(e);
      }
      case 'index':
        return this.readLValue(e);
      case 'new': {
        const cls = this.c.classes.get(e.cls);
        if (!cls) fail(e.cls === 'String' ? `Write a string literal instead of new String(...)` : `Unknown class '${e.cls}'`, e);
        em.emit('new', [e.cls]);
        em.emit('dup');
        const ctor = cls!.ctor!;
        this.args(ctor.params, e.args, `The constructor of ${e.cls}`, e);
        em.line = e.line;
        em.emit('invokespecial', [e.cls, '<init>', ctor.descriptor], -(ctor.params.length + 1));
        return e.cls;
      }
      case 'newArray': {
        this.c.checkType(`${e.elem}[]`, e);
        this.expectType(this.value(e.length), 'int', e.length);
        em.line = e.line;
        if (e.elem === 'int') em.emit('newarray', ['int']);
        else em.emit('anewarray', [e.elem === 'String' ? 'java/lang/String' : e.elem]);
        return `${e.elem}[]`;
      }
    }
  }

  private readLValue(e: Expr): string {
    const lv = this.lvalue(e);
    lv.prepare();
    lv.get();
    return lv.type;
  }

  private binary(e: Extract<Expr, { kind: 'binary' }>): string {
    if (e.op === '+' && this.typeOf(e) === 'String') return this.concat(e);
    const op = ARITH[e.op];
    if (!op) return this.materialize(e);
    this.expectType(this.value(e.left), 'int', e.left);
    this.expectType(this.value(e.right), 'int', e.right);
    this.em.line = e.line;
    this.em.emit(op);
    return 'int';
  }

  /** Flattens `a + b + c` string concatenations into their parts, left to right. */
  private concatParts(e: Expr): Expr[] {
    if (e.kind === 'binary' && e.op === '+' && this.typeOf(e) === 'String')
      return this.typeOf(e.left) === 'String' ? [...this.concatParts(e.left), e.right] : [e.left, e.right];
    return [e];
  }

  /** javac 9+: one invokedynamic with a recipe; constants are baked into the recipe. */
  private concat(e: Expr, parts = this.concatParts(e)): string {
    let recipe = '';
    const types: string[] = [];
    for (const p of parts) {
      if (p.kind === 'string') recipe += p.value;
      else if (p.kind === 'int' || p.kind === 'bool') recipe += String(p.value);
      else {
        const t = this.value(p);
        if (t === 'void') fail(`This call returns nothing (void), so it cannot be concatenated`, p);
        recipe += '\u0001';
        types.push(t === 'null' ? 'Object' : t);
      }
    }
    this.em.line = e.line;
    if (types.length === 0) this.em.emit('ldc', [recipe]);
    else {
      const desc = `(${types.map((t) => (t === 'Object' ? 'Ljava/lang/Object;' : descriptorOf(t))).join('')})Ljava/lang/String;`;
      this.em.emit('invokedynamic', ['makeConcatWithConstants', desc, recipe], 1 - types.length);
    }
    return 'String';
  }

  /** A boolean-valued expression as a value: jumps, then iconst_1 / iconst_0, like javac. */
  private materialize(e: Expr): string {
    const falseL = new Label();
    const end = new Label();
    this.jumpIfFalse(e, falseL);
    this.em.emit('iconst_1');
    this.em.jump('goto', end);
    this.em.place(falseL);
    this.em.emit('iconst_0');
    this.em.place(end);
    return 'boolean';
  }

  // ------------------------------------------------------------- conditions

  private jumpIfFalse(e: Expr, target: Label): void {
    this.cond(e, target, false);
  }

  /** Jumps to `target` when `e` evaluates to `when`; falls through otherwise. */
  private cond(e: Expr, target: Label, when: boolean): void {
    const em = this.em;
    em.line = e.line;
    if (e.kind === 'bool') {
      if (e.value === when) em.jump('goto', target);
      return;
    }
    if (e.kind === 'unary' && e.op === '!') return this.cond(e.expr, target, !when);
    if (e.kind === 'binary' && (e.op === '&&' || e.op === '||')) {
      // (a && b) is false as soon as a is false; (a || b) is true as soon as a is true.
      const shortCircuits = (e.op === '&&') === !when;
      if (shortCircuits) {
        this.cond(e.left, target, when);
        this.cond(e.right, target, when);
      } else {
        const skip = new Label();
        this.cond(e.left, skip, !when);
        this.cond(e.right, target, when);
        em.place(skip);
      }
      return;
    }
    if (e.kind === 'binary' && COND[e.op]) return this.compare(e, target, when);
    this.expectType(this.value(e), 'boolean', e);
    em.jump(when ? 'ifne' : 'ifeq', target);
  }

  private compare(e: Extract<Expr, { kind: 'binary' }>, target: Label, when: boolean): void {
    const em = this.em;
    const lt = this.typeOf(e.left);
    const rt = this.typeOf(e.right);
    let c = COND[e.op];
    if (!when) c = INVERSE[c];
    const equality = e.op === '==' || e.op === '!=';
    if (isRefType(lt) || isRefType(rt) || lt === 'null' || rt === 'null') {
      if (!equality) fail(`${e.op} only works on numbers`, e);
      if (lt !== rt && lt !== 'null' && rt !== 'null') fail(`Cannot compare a ${lt} with a ${rt}`, e);
      const nullSide = e.right.kind === 'null' ? e.left : e.left.kind === 'null' ? e.right : null;
      if (nullSide) {
        this.value(nullSide);
        em.line = e.line;
        return em.jump(c === 'eq' ? 'ifnull' : 'ifnonnull', target);
      }
      this.value(e.left);
      this.value(e.right);
      em.line = e.line;
      return em.jump(`if_acmp${c}`, target);
    }
    if (lt !== rt) fail(`Cannot compare a ${lt} with a ${rt}`, e);
    if (!equality && lt !== 'int') fail(`${e.op} only works on numbers`, e);
    this.value(e.left);
    em.line = e.line;
    // javac compares with zero using the single-operand forms (ifeq, iflt...).
    if (e.right.kind === 'int' && e.right.value === 0) return em.jump(`if${c}`, target);
    this.value(e.right);
    em.line = e.line;
    em.jump(`if_icmp${c}`, target);
  }

  // ------------------------------------------------------------- assignments

  private lvalue(e: Expr): LValue {
    const em = this.em;
    if (e.kind === 'name') {
      const r = this.resolveName(e.name, e);
      if (r.local) {
        const l = r.local;
        return { type: l.type, local: l, prepare() {}, dupPrepared() {}, get: () => this.load(l), set: () => this.store(l), dupValue: () => em.emit('dup') };
      }
      return this.fieldLValue(r.field!, null);
    }
    if (e.kind === 'field') {
      const r = this.resolveField(e);
      if (r.arrayLength) fail(`The length of an array cannot be changed`, e);
      if (!r.field) fail(`System.out cannot be assigned`, e);
      return this.fieldLValue(r.field!, r.staticOwner ? null : e.obj);
    }
    if (e.kind === 'index') {
      const t = this.arrayType(e.array);
      const ref = isRefType(elemType(t));
      return {
        type: elemType(t),
        prepare: () => {
          this.value(e.array);
          this.expectType(this.value(e.index), 'int', e.index);
          em.line = e.line;
        },
        dupPrepared: () => em.emit('dup2'),
        get: () => em.emit(ref ? 'aaload' : 'iaload'),
        set: () => em.emit(ref ? 'aastore' : 'iastore'),
        dupValue: () => em.emit('dup_x2'),
      };
    }
    return fail('You can only assign to a variable, a field or an array element', e);
  }

  /** A field; `obj` is the receiver expression, or null for `this`/static. */
  private fieldLValue(f: FieldSym, obj: Expr | null): LValue {
    const em = this.em;
    const ref = [f.owner, f.name, descriptorOf(f.type)];
    if (f.isStatic)
      return { type: f.type, prepare() {}, dupPrepared() {}, get: () => em.emit('getstatic', ref), set: () => em.emit('putstatic', ref), dupValue: () => em.emit('dup') };
    return {
      type: f.type,
      prepare: () => {
        if (obj) this.value(obj);
        else em.emit(...slotOp('aload', 0));
      },
      dupPrepared: () => em.emit('dup'),
      get: () => em.emit('getfield', ref),
      set: () => em.emit('putfield', ref),
      dupValue: () => em.emit('dup_x1'),
    };
  }

  private assign(e: Extract<Expr, { kind: 'assign' }>, want: boolean): void {
    const em = this.em;
    const lv = this.lvalue(e.target);
    if (e.op === '=') {
      lv.prepare();
      this.expectType(this.value(e.value), lv.type, e.value);
      em.line = e.line;
      if (want) lv.dupValue();
      lv.set();
      return;
    }
    if (lv.type === 'String' && e.op === '+=') {
      lv.prepare();
      lv.dupPrepared();
      lv.get();
      this.concatOnto(e.value);
    } else {
      if (lv.type !== 'int') fail(`${e.op} only works on int variables`, e);
      const v = e.value;
      // javac: `i += 5` on an int local is a single iinc.
      if (lv.local && (e.op === '+=' || e.op === '-=') && v.kind === 'int' && Math.abs(v.value) <= 127) {
        em.line = e.line;
        em.emit('iinc', [lv.local.slot, e.op === '+=' ? v.value : -v.value]);
        if (want) lv.get();
        return;
      }
      lv.prepare();
      lv.dupPrepared();
      lv.get();
      this.expectType(this.value(v), 'int', v);
      em.line = e.line;
      em.emit(ARITH[e.op]!);
    }
    if (want) lv.dupValue();
    lv.set();
  }

  /** `s += x` on a String: the current value is already on the stack. */
  private concatOnto(v: Expr): void {
    const t = v.kind === 'string' || v.kind === 'int' || v.kind === 'bool' ? null : this.value(v);
    if (t === 'void') fail(`This call returns nothing (void), so it cannot be concatenated`, v);
    const recipe = t === null ? `\u0001${v.kind === 'string' ? v.value : String((v as { value: unknown }).value)}` : '\u0001\u0001';
    const types = t === null ? ['String'] : ['String', t === 'null' ? 'Object' : t];
    const desc = `(${types.map((x) => (x === 'Object' ? 'Ljava/lang/Object;' : descriptorOf(x))).join('')})Ljava/lang/String;`;
    this.em.emit('invokedynamic', ['makeConcatWithConstants', desc, recipe], 1 - types.length);
  }

  private incdec(e: Extract<Expr, { kind: 'incdec' }>, want: boolean): void {
    const em = this.em;
    const lv = this.lvalue(e.target);
    if (lv.type !== 'int') fail(`${e.op} only works on int variables`, e);
    const delta = e.op === '++' ? 1 : -1;
    em.line = e.line;
    if (lv.local) {
      if (want && !e.prefix) lv.get();
      em.emit('iinc', [lv.local.slot, delta]);
      if (want && e.prefix) lv.get();
      return;
    }
    lv.prepare();
    lv.dupPrepared();
    lv.get();
    if (want && !e.prefix) lv.dupValue();
    em.emit('iconst_1');
    em.emit(delta > 0 ? 'iadd' : 'isub');
    if (want && e.prefix) lv.dupValue();
    lv.set();
  }

  // ------------------------------------------------------------- calls

  private call(e: Extract<Expr, { kind: 'call' }>): string {
    const em = this.em;
    const r = this.resolveCall(e);
    if (r.kind === 'println') {
      em.emit('getstatic', ['java/lang/System', 'out', 'Ljava/io/PrintStream;']);
      let desc = '()V';
      if (e.args.length) {
        const t = this.value(e.args[0]);
        if (t === 'void') fail(`This call returns nothing (void), so there is nothing to print`, e.args[0]);
        desc = `(${t === 'int' || t === 'boolean' || t === 'String' ? descriptorOf(t) : 'Ljava/lang/Object;'})V`;
      }
      em.line = e.line;
      em.emit('invokevirtual', ['java/io/PrintStream', e.name, desc], -(e.args.length + 1));
      return 'void';
    }
    if (r.kind === 'math') {
      const n = MATH[e.name];
      this.args(new Array(n).fill('int'), e.args, `Math.${e.name}`, e);
      em.line = e.line;
      em.emit('invokestatic', ['java/lang/Math', e.name, `(${'I'.repeat(n)})I`], 1 - n);
      return 'int';
    }
    const sym = r.sym!;
    if (r.kind === 'virtual') {
      if (e.target) this.value(e.target);
      else em.emit(...slotOp('aload', 0));
    }
    this.args(sym.params, e.args, `${sym.name}`, e);
    em.line = e.line;
    const effect = -(sym.params.length + (r.kind === 'virtual' ? 1 : 0)) + (sym.ret === 'void' ? 0 : 1);
    em.emit(r.kind === 'virtual' ? 'invokevirtual' : 'invokestatic', [sym.owner, sym.name, sym.descriptor], effect);
    return sym.ret;
  }
}

// ------------------------------------------------------------------ flow analysis

/** Can execution fall off the end of `s`? (Decides the implicit `return` and "missing return".) */
export function canComplete(s: Stmt): boolean {
  switch (s.kind) {
    case 'return':
    case 'break':
    case 'continue':
      return false;
    case 'block':
      return s.body.every(canComplete);
    case 'if':
      return s.else ? canComplete(s.then) || canComplete(s.else) : true;
    case 'while':
      return !(s.cond.kind === 'bool' && s.cond.value) || hasBreak(s.body);
    case 'for':
      return !(s.cond === null || (s.cond.kind === 'bool' && s.cond.value)) || hasBreak(s.body);
    default:
      return true;
  }
}

/** Does `s` contain a `break` for the enclosing loop (not one of a nested loop)? */
function hasBreak(s: Stmt): boolean {
  switch (s.kind) {
    case 'break':
      return true;
    case 'block':
      return s.body.some(hasBreak);
    case 'if':
      return hasBreak(s.then) || (s.else !== null && hasBreak(s.else));
    default:
      return false;
  }
}
