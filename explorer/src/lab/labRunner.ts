// Runs a Code Lab program on the toy JVM: the bytecode VM executes it, and
// this runner mirrors what happens into the simulation. Calls become frames
// on the Lab's thread tower, hot methods are compiled by the (simulated) JIT
// and then run faster, every `new` lands in Eden, and at each collection the
// objects the program can no longer reach are handed to the GC.

import { Emitter } from '../sim/emitter';
import type { HeapObject } from '../sim/heap';
import { LAB_KLASS, type JvmSim } from '../sim/jvm';
import type { Frame } from '../sim/threads';
import { Vm, compile, type CompileError, type MethodInfo, type Program, type VmRef } from '../lang';

export type LabState = 'empty' | 'ready' | 'running' | 'paused' | 'finished' | 'crashed';

type LabEvents = {
  state: LabState;
  print: string;
  /** One of the program's methods got compiled by the JIT. */
  compiled: { method: string; tier: 3 | 4 };
  crashed: { name: string; message: string; line: number };
};

/** How much faster compiled code runs than interpreted code, per tier. */
export const TIER_SPEEDUP: Record<0 | 3 | 4, number> = { 0: 1, 3: 4, 4: 15 };
/** Invocations one call counts for (a loop iteration counts for 1). */
export const CALL_WEIGHT = 5;
/** Never run more than this many instructions in one animation frame. */
const MAX_PER_FRAME = 40_000;

/** A readable method name, as the JIT and the feed show it. */
export const methodLabel = (m: MethodInfo) => `${m.owner}.${m.name}`;

export class LabRunner extends Emitter<LabEvents> {
  state: LabState = 'empty';
  program: Program | null = null;
  vm: Vm | null = null;
  errors: CompileError[] = [];
  /** Interpreted instructions per second (compiled code goes faster, see TIER_SPEEDUP). */
  speed = 30;

  private jitIndex = new Map<number, number>();
  private readonly objects = new Map<VmRef, HeapObject>();
  private readonly frames = new Map<number, Frame>();
  private debt = 0;

  constructor(private readonly sim: JvmSim) {
    super();
    sim.heap.on('gcStart', () => this.collect());
    sim.jit.on('installed', (nm) => {
      const m = this.program?.methods.find((x) => this.jitIndex.get(x.id) === nm.method);
      if (m) this.emit('compiled', { method: methodLabel(m), tier: nm.tier });
    });
  }

  /** Compiles `source`; on success the program is ready to run. */
  load(source: string): boolean {
    this.stop();
    const result = compile(source);
    if (!result.ok) {
      this.errors = result.errors;
      this.program = null;
      this.setState('empty');
      return false;
    }
    this.errors = [];
    this.program = result.program;
    this.jitIndex = new Map(result.program.methods.map((m) => [m.id, this.sim.jit.register(methodLabel(m)).index]));
    this.reset();
    return true;
  }

  /** Back to the start of the program. The JIT keeps what it learned: a warm JVM, like a second request to a server. */
  reset(): void {
    if (!this.program) return;
    this.stop();
    this.vm = new Vm(this.program, {
      call: (m) => this.sim.jit.invoke(this.jitIndex.get(m.id)!, CALL_WEIGHT),
      backEdge: (m) => this.sim.jit.invoke(this.jitIndex.get(m.id)!, 1),
      alloc: (ref, size) => this.alloc(ref, size),
      print: (text) => this.emit('print', text),
    });
    this.setState('ready');
    this.syncThread();
  }

  run(): void {
    if (!this.vm) return;
    if (this.state === 'finished' || this.state === 'crashed') this.reset();
    this.sim.loadKlass(LAB_KLASS);
    this.setState('running');
  }

  pause(): void {
    if (this.state === 'running') this.setState('paused');
  }

  /** One bytecode instruction, while paused (or before running). */
  step(): void {
    if (!this.vm || !(this.state === 'paused' || this.state === 'ready')) return;
    this.sim.loadKlass(LAB_KLASS);
    if (this.state === 'ready') this.setState('paused');
    this.exec(1);
  }

  /** The JIT tier the current method runs at. */
  currentTier(): 0 | 3 | 4 {
    const top = this.vm?.current?.frame.method;
    return top ? this.sim.jit.methods[this.jitIndex.get(top.id)!].tier : 0;
  }

  jitTierOf(m: MethodInfo): 0 | 3 | 4 {
    return this.sim.jit.methods[this.jitIndex.get(m.id)!].tier;
  }

  update(dt: number): void {
    if (this.state !== 'running' || !this.vm) return;
    // Stopped at a safepoint like every other thread (and paused with the JVM).
    if (this.sim.safepoint || this.sim.paused) return;
    this.debt += dt * this.speed * TIER_SPEEDUP[this.currentTier()];
    const n = Math.min(MAX_PER_FRAME, Math.floor(this.debt));
    this.debt -= n;
    if (n > 0) this.exec(n);
  }

  private exec(n: number): void {
    const vm = this.vm!;
    for (let i = 0; i < n && vm.step(); i++);
    this.syncThread();
    if (vm.state === 'finished') this.end('finished');
    else if (vm.state === 'crashed') {
      this.emit('crashed', vm.error!);
      this.end('crashed');
    }
  }

  private end(state: 'finished' | 'crashed'): void {
    this.debt = 0;
    this.setState(state);
    // The program is over: nothing it allocated is reachable any more.
    for (const o of this.objects.values()) this.sim.heap.kill(o);
    this.objects.clear();
  }

  private stop(): void {
    if (this.vm) for (const o of this.objects.values()) this.sim.heap.kill(o);
    this.objects.clear();
    this.frames.clear();
    this.debt = 0;
    this.vm = null;
    const lab = this.sim.threads.lab;
    lab.frames = [];
    lab.pc = 0;
  }

  private alloc(ref: VmRef, size: number): void {
    const o = this.sim.heap.allocate({ klass: LAB_KLASS, size, lifetime: Infinity });
    if (o) this.objects.set(ref, o);
  }

  /** A real mark phase: from the VM's roots, through fields and array slots. */
  private collect(): void {
    if (!this.vm || this.objects.size === 0) return;
    const live = this.vm.reachable();
    for (const [ref, o] of this.objects)
      if (!live.has(ref)) {
        this.sim.heap.kill(o);
        this.objects.delete(ref);
      }
  }

  /** Mirrors the VM's call stack onto the Lab's thread tower. */
  private syncThread(): void {
    const lab = this.sim.threads.lab;
    const vm = this.vm;
    if (!vm) return;
    const live = new Set<number>();
    lab.frames = vm.frames.map((f) => {
      live.add(f.id);
      let frame = this.frames.get(f.id);
      if (!frame) this.frames.set(f.id, (frame = { id: -f.id, method: this.jitIndex.get(f.method.id)! }));
      return frame;
    });
    for (const id of this.frames.keys()) if (!live.has(id)) this.frames.delete(id);
    lab.pc = vm.current?.instr.offset ?? 0;
  }

  /** How many objects of the program are still alive in the heap. */
  get liveObjects(): number {
    return this.objects.size;
  }

  private setState(s: LabState): void {
    if (s === this.state) return;
    this.state = s;
    this.emit('state', s);
  }
}
