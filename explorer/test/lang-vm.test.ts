import { describe, expect, it } from 'vitest';
import { SAMPLES, Vm, compile, formatValue, type MethodInfo, type Program, type VmHooks, type VmRef } from '../src/lang';

function program(src: string): Program {
  const r = compile(src);
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}:${e.col} ${e.message}`).join('\n'));
  return r.program;
}

const inMain = (body: string, extra = '') => `class Main {\n${extra}\npublic static void main(String[] args) {\n${body}\n}\n}`;

function run(src: string, hooks: VmHooks = {}, budget = 2_000_000): Vm {
  const vm = new Vm(program(src), hooks);
  vm.run(budget);
  return vm;
}

describe('Vm: semantics', () => {
  it('runs arithmetic and prints', () => {
    const vm = run(inMain('int a = 6; int b = 7; System.out.println("a*b = " + a * b); System.out.println(7 / 2); System.out.println(-7 % 3);'));
    expect(vm.state).toBe('finished');
    expect(vm.output).toEqual(['a*b = 42', '3', '-1']);
  });

  it('wraps int overflow like the JVM', () => {
    const vm = run(inMain('int big = 2147483647; big++; System.out.println(big); System.out.println(65536 * 65536);'));
    expect(vm.output).toEqual(['-2147483648', '0']);
  });

  it('prints booleans as true/false', () => {
    const vm = run(inMain('int n = 3; boolean b = n > 2; System.out.println(b); System.out.println("big: " + !b);'));
    expect(vm.output).toEqual(['true', 'big: false']);
  });

  it('short-circuits && and ||', () => {
    const vm = run(inMain('int[] a = null; if (a != null && a.length > 0) System.out.println("no"); if (a == null || a.length > 0) System.out.println("yes");'));
    expect(vm.output).toEqual(['yes']);
  });

  it('handles while, break, continue and compound assignments', () => {
    const vm = run(inMain('int i = 0; int s = 0; while (true) { i++; if (i > 10) break; if (i % 2 == 0) continue; s += i; } s *= 2; s -= 1; System.out.println(s);'));
    expect(vm.output).toEqual(['49']);
  });

  it('supports fields, constructors, instance methods and statics', () => {
    const vm = run(`
class Counter {
  static int created;
  int count = 10;
  Counter() { created++; }
  void add(int n) { count += n; this.count++; }
}
class Main {
  public static void main(String[] args) {
    Counter c = new Counter();
    c.add(5);
    new Counter();
    System.out.println(c.count + " " + Counter.created);
  }
}`);
    expect(vm.output).toEqual(['16 2']);
  });

  it('formats records, objects and arrays', () => {
    const vm = run('record Point(int x, int y) {}\nclass Box {}\n' + inMain('System.out.println(new Point(1, 2)); int[] a = new int[5]; System.out.println(a); System.out.println(new Box());'));
    expect(vm.output[0]).toBe('Point[x=1, y=2]');
    expect(vm.output[1]).toBe('int[5]');
    expect(vm.output[2]).toMatch(/^Box@[0-9a-f]+$/);
    expect(formatValue(null)).toBe('null');
  });

  it('uses Math.max/min/abs and postfix/prefix values', () => {
    const vm = run(inMain('int i = 5; int a = i++; int b = ++i; System.out.println(a + " " + b + " " + Math.max(a, b) + " " + Math.abs(-3) + " " + Math.min(1, 2));'));
    expect(vm.output).toEqual(['5 7 7 3 1']);
  });

  it('updates array elements and fields in place', () => {
    const vm = run('class P { int v; }\n' + inMain('int[] a = new int[3]; a[1] = 4; a[1] += 3; a[2]++; P p = new P(); p.v = 2; p.v *= 5; p.v--; System.out.println(a[1] + " " + a[2] + " " + p.v + " " + (a[0] = 9) + " " + a[0]);'));
    expect(vm.output).toEqual(['7 1 9 9 9']);
  });

  it('throws ArithmeticException on / by zero, with the line', () => {
    const vm = run(inMain('int z = 0;\nint x = 1 / z;'));
    expect(vm.state).toBe('crashed');
    expect(vm.error).toEqual({ name: 'ArithmeticException', message: '/ by zero', line: 5 });
  });

  it('throws ArrayIndexOutOfBoundsException and NullPointerException', () => {
    expect(run(inMain('int[] a = new int[5]; a[5] = 1;')).error).toMatchObject({ name: 'ArrayIndexOutOfBoundsException', message: 'Index 5 out of bounds for length 5' });
    expect(run('class N { int v; }\n' + inMain('N n = null; n.v = 1;')).error?.name).toBe('NullPointerException');
    expect(run(inMain('int[] a = new int[-1];')).error?.name).toBe('NegativeArraySizeException');
  });

  it('throws StackOverflowError past the maximum depth', () => {
    const src = inMain('f(0);', 'static int f(int n) { return f(n + 1); }');
    const vm = new Vm(program(src), {}, { maxDepth: 10 });
    vm.run(100_000);
    expect(vm.error?.name).toBe('StackOverflowError');
    expect(vm.frames.length).toBe(10);
  });

  it('runs static initialisers before main', () => {
    const vm = run('class Main { static int x = 41; public static void main(String[] args) { x++; System.out.println(x); } }');
    expect(vm.output).toEqual(['42']);
  });

  it('exposes the current frame and instruction', () => {
    const vm = new Vm(program(inMain('int a = 1;')));
    expect(vm.state).toBe('ready');
    expect(vm.current?.instr.text).toBe('iconst_1');
    vm.step();
    expect(vm.current?.frame.stack).toEqual([1]);
    expect(vm.current?.instr.text).toBe('istore_1');
    vm.run();
    expect(vm.current).toBeNull();
  });
});

describe('Vm: garbage collection support', () => {
  it('reachable() keeps what the program can still reach and drops the rest', () => {
    const allocated: VmRef[] = [];
    const vm = new Vm(
      program(`
class Node { Node next; }
class Main {
  public static void main(String[] args) {
    Node keep = new Node();
    keep.next = new Node();
    Node lost = new Node();
    lost = null;
    int[] scratch = new int[4];
    scratch = null;
    System.out.println("done");
  }
}`),
      { alloc: (r) => allocated.push(r) },
    );
    while (vm.current && !vm.current.instr.text.startsWith('getstatic')) vm.step();
    const live = vm.reachable();
    expect(allocated).toHaveLength(4);
    expect(live.has(allocated[0])).toBe(true); // keep
    expect(live.has(allocated[1])).toBe(true); // keep.next
    expect(live.has(allocated[2])).toBe(false); // lost
    expect(live.has(allocated[3])).toBe(false); // scratch
  });
});

describe('Vm: hooks', () => {
  it('balances calls and returns, and reports depth', () => {
    let depth = 0;
    let max = 0;
    let calls = 0;
    run(inMain('fib(6);', 'static int fib(int n) { if (n < 2) return n; return fib(n - 1) + fib(n - 2); }'), {
      call: (_m, d) => {
        calls++;
        depth++;
        max = Math.max(max, d);
        expect(d).toBe(depth);
      },
      ret: (_m, d) => {
        expect(d).toBe(depth);
        depth--;
      },
    });
    expect(depth).toBe(0);
    expect(calls).toBe(26); // main + 25 calls of fib(6)
    expect(max).toBe(7);
  });

  it('reports allocation sizes with compact headers, rounded to 8 bytes', () => {
    const sizes: number[] = [];
    run('class E {}\nclass One { int a; }\nclass Three { int a; int b; int c; }\n' + inMain('new E(); new One(); new Three(); int[] a = new int[5]; int[] b = new int[0];'), {
      alloc: (_r, size) => sizes.push(size),
    });
    expect(sizes).toEqual([8, 16, 24, 32, 16]);
  });

  it('counts loop iterations as back-edges', () => {
    const edges: MethodInfo[] = [];
    run(inMain('for (int i = 0; i < 25; i++) {}'), { backEdge: (m) => edges.push(m) });
    expect(edges).toHaveLength(25);
    expect(edges[0].name).toBe('main');
  });

  it('reports prints and exceptions', () => {
    const printed: string[] = [];
    const thrown: string[] = [];
    run(inMain('System.out.print("a"); System.out.println("b"); int x = 1 / 0;'), { print: (t) => printed.push(t), throw: (n) => thrown.push(n) });
    expect(printed).toEqual(['a', 'b\n']);
    expect(thrown).toEqual(['ArithmeticException']);
  });
});

describe('samples', () => {
  const expected: Record<string, (vm: Vm) => void> = {
    stack: (vm) => expect(vm.output).toEqual(['answer = 42', 'shifted = 4']),
    fib: (vm) => expect(vm.output).toEqual(['fib(15) = 610']),
    hot: (vm) => expect(vm.output).toEqual(['sum = 65670000']),
    garbage: (vm) => expect(vm.output[0]).toMatch(/^\d+ points inside the circle$/),
    survivors: (vm) => expect(vm.output).toEqual(['400 nodes, sum = 80200']),
    sort: (vm) => expect(vm.output[0]).toMatch(/^smallest = \d+, largest = \d+$/),
    overflow: (vm) => expect(vm.error?.name).toBe('StackOverflowError'),
    oops: (vm) => expect(vm.error?.name).toBe('ArithmeticException'),
  };

  it('has a check for every sample', () => {
    expect(SAMPLES.map((s) => s.id).sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(SAMPLES.map((s) => [s.id, s] as const))('%s compiles, runs and ends as expected', (id, sample) => {
    const r = compile(sample.code);
    if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}: ${e.message}`).join('\n'));
    const vm = new Vm(r.program);
    vm.run(3_000_000);
    expect(['finished', 'crashed']).toContain(vm.state);
    expected[id](vm);
    if (vm.state === 'finished') expect(vm.output.length).toBeGreaterThan(0);
    expect(sample.code.split('\n').length).toBeLessThanOrEqual(32);
  });

  it('sorts correctly', () => {
    const r = compile(SAMPLES.find((s) => s.id === 'sort')!.code.replace('System.out.println("smallest', 'for (int i = 1; i < a.length; i++) if (a[i - 1] > a[i]) System.out.println("unsorted");\n    System.out.println("smallest'));
    expect(r.ok).toBe(true);
    const vm = new Vm((r as { program: Program }).program);
    vm.run();
    expect(vm.output).toHaveLength(1);
  });
});
