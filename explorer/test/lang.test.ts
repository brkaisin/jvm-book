import { describe, expect, it } from 'vitest';
import { compile, type MethodInfo, type Program } from '../src/lang';
import { tokenize } from '../src/lang/lexer';
import { parse } from '../src/lang/parser';

/** Compiles, failing the test with the compiler's messages if it does not. */
function program(src: string): Program {
  const r = compile(src);
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}:${e.col} ${e.message}`).join('\n'));
  return r.program;
}

const method = (p: Program, name: string): MethodInfo => p.methods.find((m) => m.name === name)!;
const ops = (m: MethodInfo) => m.code.map((i) => i.text);
const inMain = (body: string, extra = '') => `class Main {\n${extra}\npublic static void main(String[] args) {\n${body}\n}\n}`;
const errorsOf = (src: string) => {
  const r = compile(src);
  return r.ok ? [] : r.errors;
};

describe('lexer and parser', () => {
  it('tokenizes with positions, skipping comments', () => {
    const t = tokenize('int x = 42; // hi\n/* multi\nline */ x += 1;');
    expect(t.map((x) => x.value)).toEqual(['int', 'x', '=', '42', ';', 'x', '+=', '1', ';', '']);
    expect(t[5]).toMatchObject({ line: 3, col: 9 });
  });

  it('parses classes, records, members and precedence', () => {
    const u = parse('record P(int x, int y) { int s() { return x + y * 2; } }\nclass Main { static int n = 3; Main() {} }');
    expect(u.classes.map((c) => [c.name, c.isRecord])).toEqual([
      ['P', true],
      ['Main', false],
    ]);
    const ret = u.classes[0].methods[0].body.body[0];
    expect(ret).toMatchObject({ kind: 'return', value: { kind: 'binary', op: '+', right: { kind: 'binary', op: '*' } } });
    expect(u.classes[1].fields[0]).toMatchObject({ name: 'n', isStatic: true });
    expect(u.classes[1].methods[0].isCtor).toBe(true);
  });

  it('folds negative literals like javac', () => {
    const p = program(inMain('int a = -5; int b = -200;'));
    expect(ops(method(p, 'main')).slice(0, 4)).toEqual(['bipush -5', 'istore_1', 'sipush -200', 'istore_2']);
  });
});

describe('compiler: javac-like bytecode', () => {
  it('uses short forms and iinc', () => {
    const p = program(inMain('int a = 5; a++;'));
    expect(ops(method(p, 'main'))).toEqual(['iconst_5', 'istore_1', 'iinc 1, 1', 'return']);
  });

  it('compiles a static method with real offsets and a descriptor', () => {
    const p = program(inMain('', 'static int sq(int x) { return x * x; }'));
    const m = method(p, 'sq');
    expect(m.descriptor).toBe('(I)I');
    expect(ops(m)).toEqual(['iload_0', 'iload_0', 'imul', 'ireturn']);
    expect(m.code.map((i) => i.offset)).toEqual([0, 1, 2, 3]);
    expect(m.maxStack).toBe(2);
    expect(m.maxLocals).toBe(1);
  });

  it('picks constant instructions by size', () => {
    const p = program(inMain('int a = 3; int b = 100; int c = 1000; int d = 100000;'));
    const m = method(p, 'main');
    expect(ops(m).filter((t) => !t.startsWith('istore'))).toEqual(['iconst_3', 'bipush 100', 'sipush 1000', 'ldc 100000', 'return']);
    // iconst 1 byte, bipush 2, sipush 3, ldc 2, plus 1-byte stores
    expect(m.code.map((i) => i.offset)).toEqual([0, 1, 2, 4, 5, 8, 9, 11, 13]);
  });

  it('compiles a for loop like javac: condition on top, inverted jump, goto back', () => {
    const p = program(inMain('int s = 0; for (int i = 0; i < 10; i++) { s += i; }'));
    expect(ops(method(p, 'main'))).toEqual([
      'iconst_0',
      'istore_1',
      'iconst_0',
      'istore_2',
      'iload_2',
      'bipush 10',
      'if_icmpge 20',
      'iload_1',
      'iload_2',
      'iadd',
      'istore_1',
      'iinc 2, 1',
      'goto 4',
      'return',
    ]);
    const m = method(p, 'main');
    const jump = m.code.find((i) => i.op === 'if_icmpge')!;
    expect(m.code[jump.target!].op).toBe('return');
  });

  it('compares with zero using the one-operand jumps, and null with ifnull', () => {
    const p = program(inMain('int x = 1; if (x == 0) x = 2; Main m = null; if (m != null) x = 3;'));
    const t = ops(method(p, 'main'));
    expect(t).toContain('ifne 8');
    expect(t.some((x) => x.startsWith('ifnull'))).toBe(true);
  });

  it('concatenates strings with invokedynamic, baking constants into the recipe', () => {
    const p = program(inMain('int n = 3; boolean b = n > 2; System.out.println("n = " + n + ", big: " + b);'));
    const indy = method(p, 'main').code.find((i) => i.op === 'invokedynamic')!;
    expect(indy.text).toBe('invokedynamic makeConcatWithConstants:(IZ)Ljava/lang/String;');
    expect(indy.operands[2]).toBe('n = \u0001, big: \u0001');
    expect(indy.offset).toBeGreaterThan(0);
  });

  it('adds numbers before a string like Java does: 1 + 2 + "x" is "3x"', () => {
    const p = program(inMain('int a = 1; int b = 2; System.out.println(a + b + "x");'));
    const t = ops(method(p, 'main'));
    expect(t.indexOf('iadd')).toBeLessThan(t.findIndex((x) => x.startsWith('invokedynamic')));
  });

  it('builds records: canonical constructor and accessors', () => {
    const p = program('record Point(int x, int y) {}\n' + inMain('Point p = new Point(1, 2); System.out.println(p.x());'));
    const ctor = p.methods.find((m) => m.owner === 'Point' && m.name === '<init>')!;
    expect(ctor.descriptor).toBe('(II)V');
    expect(ops(ctor)).toEqual([
      'aload_0',
      'invokespecial java/lang/Object.<init>:()V',
      'aload_0',
      'iload_1',
      'putfield Point.x:I',
      'aload_0',
      'iload_2',
      'putfield Point.y:I',
      'return',
    ]);
    expect(ops(p.methods.find((m) => m.owner === 'Point' && m.name === 'x')!)).toEqual(['aload_0', 'getfield Point.x:I', 'ireturn']);
    expect(ops(method(p, 'main')).slice(0, 5)).toEqual(['new Point', 'dup', 'iconst_1', 'iconst_2', 'invokespecial Point.<init>:(II)V']);
  });

  it('prints with getstatic System.out and the right println overload', () => {
    const p = program(inMain('System.out.println(42); System.out.println(true); System.out.println("hi");'));
    const calls = ops(method(p, 'main')).filter((t) => t.startsWith('invokevirtual'));
    expect(calls).toEqual([
      'invokevirtual java/io/PrintStream.println:(I)V',
      'invokevirtual java/io/PrintStream.println:(Z)V',
      'invokevirtual java/io/PrintStream.println:(Ljava/lang/String;)V',
    ]);
    expect(ops(method(p, 'main'))[0]).toBe('getstatic java/lang/System.out:Ljava/io/PrintStream;');
  });

  it('keeps track of source lines and local names', () => {
    const p = program('class Main {\n  public static void main(String[] args) {\n    int total = 1;\n    total = total * 2;\n  }\n}');
    const m = method(p, 'main');
    expect(m.code[0].line).toBe(3);
    expect(m.code.find((i) => i.op === 'imul')!.line).toBe(4);
    expect(m.localNames).toEqual(['args', 'total']);
  });

  it('finds main', () => {
    const p = program('class A { static int f() { return 1; } }\n' + inMain(''));
    expect(p.methods[p.main].name).toBe('main');
  });
});

describe('compiler: friendly errors', () => {
  const first = (src: string) => errorsOf(src)[0];

  it('reports unknown names with their line', () => {
    expect(first(inMain('int a = 1;\nb = 2;'))).toMatchObject({ line: 5, message: "Unknown variable 'b'" });
    expect(first(inMain('foo();'))?.message).toBe("Unknown method 'foo' in Main");
    expect(first(inMain('Nope n = null;'))?.message).toBe("Unknown type 'Nope'");
  });

  it('reports type mismatches and argument counts', () => {
    expect(first(inMain('int a = true;'))?.message).toBe('Type mismatch: expected int but this is a boolean');
    expect(first(inMain('int a = f(1, 2);', 'static int f(int x) { return x; }'))?.message).toBe('f takes 1 argument, not 2');
  });

  it('reports a missing return value, and a missing main', () => {
    expect(first(inMain('', 'static int f(int x) { if (x > 0) return 1; }'))?.message).toBe('Method f must return a int: add a return statement');
    expect(first('class A { }')?.message).toMatch(/No main method/);
  });

  it('reports syntax errors with line and column', () => {
    expect(first('class Main {\n  void f() {\n    int x = ;\n  }\n}')).toMatchObject({ line: 3, col: 13 });
  });

  it('collects several errors', () => {
    expect(errorsOf(inMain('int a = x;\nint b = y;')).length).toBe(2);
  });

  it('rejects instance access from static code', () => {
    expect(first('class Main { int n; public static void main(String[] args) { n = 1; } }')?.message).toMatch(/instance field/);
  });

  it('rejects unsupported types kindly', () => {
    expect(first(inMain('long x = 1;'))?.message).toBe("The type 'long' is not supported here: use int");
  });
});
