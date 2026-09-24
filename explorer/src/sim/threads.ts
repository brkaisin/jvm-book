// Threads calling methods: platform threads with their own stacks, and
// virtual threads multiplexed onto a few carrier threads. A virtual thread
// that blocks unmounts, and its frames are kept aside (as heap stack chunks)
// until it is runnable again.

import { Emitter } from './emitter';
import { Rng } from './rng';

export interface Frame {
  readonly id: number;
  readonly method: number;
}

/** `lab`: the Code Lab's thread, whose frames are driven by the bytecode VM, not by this simulation. */
export type ThreadKind = 'platform' | 'carrier' | 'lab';

export interface PlatformThread {
  readonly index: number;
  readonly name: string;
  readonly kind: ThreadKind;
  /** For carriers this is the mounted virtual thread's stack. */
  frames: Frame[];
  /** Bytecode offset in the top frame. */
  pc: number;
  mounted: VirtualThread | null;
  nextCallAt: number;
}

export type VThreadState = 'queued' | 'mounted' | 'parked' | 'done';

export interface VirtualThread {
  readonly id: number;
  state: VThreadState;
  /** Its stack; lives in the heap as stack chunks while unmounted. */
  frames: Frame[];
  /** When the current state ends (block or wake up). */
  until: number;
  carrier: number | null;
  /** How many more times it will run before finishing; Infinity = forever. */
  runsLeft: number;
}

type ThreadEvents = {
  call: { thread: number; method: number };
  mount: { vthread: VirtualThread; carrier: number };
  unmount: { vthread: VirtualThread; carrier: number; finished: boolean };
};

export interface ThreadOptions {
  rng?: Rng;
  platform?: string[];
  carriers?: number;
  vthreads?: number;
  maxVthreads?: number;
  /** Picks the method a new frame will run. */
  pickMethod: () => number;
}

const MIN_DEPTH = 2;
const MAX_DEPTH = 11;
/** How deep a visitor can push a thread (the view shows up to 16 frames). */
export const BURST_DEPTH = 16;

export class ThreadSim extends Emitter<ThreadEvents> {
  readonly threads: PlatformThread[];
  readonly vthreads: VirtualThread[] = [];
  now = 0;

  private readonly rng: Rng;
  private readonly pickMethod: () => number;
  private readonly maxVthreads: number;
  private nextFrameId = 1;
  private nextVtId = 1;

  constructor(o: ThreadOptions) {
    super();
    this.rng = o.rng ?? new Rng();
    this.pickMethod = o.pickMethod;
    this.maxVthreads = o.maxVthreads ?? 200;
    const names = o.platform ?? ['main', 'http-nio-1', 'worker-2', 'scheduler'];
    const carriers = o.carriers ?? 2;
    const specs: [string, ThreadKind][] = [
      ...names.map((name): [string, ThreadKind] => [name, 'platform']),
      ...Array.from({ length: carriers }, (_, i): [string, ThreadKind] => [`ForkJoinPool-1-worker-${i + 1}`, 'carrier']),
      ['your code', 'lab'],
    ];
    this.threads = specs.map(([name, kind], index) => ({ index, name, kind, frames: [], pc: 0, mounted: null, nextCallAt: 0 }));
    for (const t of this.threads) if (t.kind === 'platform') t.frames = this.makeStack(this.rng.int(4) + 3);
    this.spawn(o.vthreads ?? 24, Infinity);
  }

  get carriers(): PlatformThread[] {
    return this.threads.filter((t) => t.kind === 'carrier');
  }

  /** The Code Lab's thread. */
  get lab(): PlatformThread {
    return this.threads.find((t) => t.kind === 'lab')!;
  }

  countVthreads(state: VThreadState): number {
    return this.vthreads.reduce((n, v) => n + (v.state === state ? 1 : 0), 0);
  }

  /** Starts `n` new virtual threads; returns how many were actually created. */
  spawn(n: number, runs = 0): number {
    const room = Math.max(0, this.maxVthreads - this.vthreads.length);
    const k = Math.min(n, room);
    for (let i = 0; i < k; i++)
      this.vthreads.push({
        id: this.nextVtId++,
        state: 'queued',
        frames: this.makeStack(this.rng.int(3) + 2),
        until: 0,
        carrier: null,
        runsLeft: runs || this.rng.int(3) + 1,
      });
    return k;
  }

  /** Makes `thread` call `n` methods in a row, deeper than it usually goes. */
  callDeeper(thread: number, n: number): void {
    const t = this.threads[thread];
    for (let i = 0; i < n && t.frames.length < BURST_DEPTH; i++) {
      const f = this.makeFrame();
      t.frames.push(f);
      this.emit('call', { thread: t.index, method: f.method });
    }
    t.pc = 0;
    t.nextCallAt = this.now + 1.2; // stay deep for a moment, then unwind
  }

  /** `frozen` = stopped at a safepoint: nothing moves. */
  step(dt: number, frozen = false): void {
    if (frozen) return;
    this.now += dt;
    for (const t of this.threads) {
      if (t.kind === 'lab') continue;
      if (t.kind === 'carrier') this.stepCarrier(t);
      if (t.frames.length === 0) continue;
      t.pc = (t.pc + 1 + this.rng.int(3)) % 64;
      if (this.now >= t.nextCallAt) this.callOrReturn(t);
    }
    for (const v of this.vthreads)
      if (v.state === 'parked' && this.now >= v.until) {
        v.state = 'queued';
      }
    for (let i = this.vthreads.length - 1; i >= 0; i--) if (this.vthreads[i].state === 'done') this.vthreads.splice(i, 1);
  }

  private stepCarrier(c: PlatformThread): void {
    const v = c.mounted;
    if (v && this.now >= v.until) {
      // It blocks (I/O, a lock, sleep...): unmount, freeing the carrier.
      v.runsLeft--;
      const finished = v.runsLeft <= 0;
      v.state = finished ? 'done' : 'parked';
      v.until = this.now + this.rng.range(1.5, 5);
      v.carrier = null;
      c.mounted = null;
      c.frames = [];
      this.emit('unmount', { vthread: v, carrier: c.index, finished });
    }
    if (!c.mounted) {
      const next = this.vthreads.find((x) => x.state === 'queued');
      if (!next) return;
      next.state = 'mounted';
      next.carrier = c.index;
      next.until = this.now + this.rng.range(0.8, 2.4);
      c.mounted = next;
      c.frames = next.frames;
      c.nextCallAt = this.now + 0.2;
      this.emit('mount', { vthread: next, carrier: c.index });
    }
  }

  private callOrReturn(t: PlatformThread): void {
    const d = t.frames.length;
    const push = d <= MIN_DEPTH || (d < MAX_DEPTH && this.rng.chance(0.55));
    if (push) {
      const f = this.makeFrame();
      t.frames.push(f);
      t.pc = 0;
      this.emit('call', { thread: t.index, method: f.method });
    } else {
      t.frames.pop();
    }
    t.nextCallAt = this.now + this.rng.range(0.18, 0.55);
  }

  private makeFrame(): Frame {
    return { id: this.nextFrameId++, method: this.pickMethod() };
  }

  private makeStack(depth: number): Frame[] {
    return Array.from({ length: depth }, () => this.makeFrame());
  }
}
