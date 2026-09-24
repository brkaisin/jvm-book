// Tiered compilation in miniature: methods start interpreted (tier 0), get
// compiled by C1 with profiling (tier 3) once warm, then by C2 (tier 4) once
// hot. C2 code can be thrown away again (deoptimisation). Compiled code lives
// in a segmented code cache.

import { Emitter } from './emitter';
import { Rng } from './rng';

export type Tier = 0 | 3 | 4;
export type Segment = 'nonNmethod' | 'profiled' | 'nonProfiled';

export interface MethodInfo {
  readonly name: string;
  /** Relative call frequency: how often threads call it. */
  readonly weight: number;
}

export const METHODS: readonly MethodInfo[] = [
  { name: 'String.hashCode', weight: 9 },
  { name: 'HashMap.get', weight: 8 },
  { name: 'Order.total', weight: 6 },
  { name: 'ArrayList.add', weight: 6 },
  { name: 'Json.parse', weight: 4 },
  { name: 'Router.handle', weight: 4 },
  { name: 'List.map', weight: 3 },
  { name: 'Codec.encode', weight: 3 },
  { name: 'Point.distance', weight: 2 },
  { name: 'Http.read', weight: 2 },
  { name: 'Shop.checkout', weight: 1.5 },
  { name: 'Config.load', weight: 0.4 },
];

export const SEGMENT_SLOTS: Record<Segment, number> = { nonNmethod: 10, profiled: 20, nonProfiled: 20 };

export interface Method extends MethodInfo {
  readonly index: number;
  tier: Tier;
  invocations: number;
  /** Tier currently being compiled, if any. */
  compiling: 3 | 4 | null;
  deopts: number;
}

export interface NMethod {
  readonly method: number;
  readonly tier: 3 | 4;
  readonly segment: Segment;
  readonly slot: number;
  /** "Not entrant": replaced or invalidated, waiting to be flushed. */
  notEntrant: boolean;
  readonly installedAt: number;
  flushAt?: number;
}

type JitEvents = {
  compileStart: { method: number; tier: 3 | 4 };
  installed: NMethod;
  deopt: { method: number };
};

export interface JitOptions {
  rng?: Rng;
  c1Threshold?: number;
  c2Threshold?: number;
  c1Seconds?: number;
  c2Seconds?: number;
  /** Chance per second that a given C2 method's speculation fails. */
  deoptRate?: number;
}

const segmentOf = (tier: 3 | 4): Segment => (tier === 3 ? 'profiled' : 'nonProfiled');
const FLUSH_DELAY = 1.6;

export class JitSim extends Emitter<JitEvents> {
  readonly methods: Method[];
  /** Code cache contents by segment; index = slot. */
  readonly codeCache: Record<Segment, (NMethod | null)[]>;
  now = 0;
  totalDeopts = 0;

  private readonly rng: Rng;
  private readonly o: Required<Omit<JitOptions, 'rng'>>;
  private readonly queue: { method: number; tier: 3 | 4; doneAt: number }[] = [];

  constructor(o: JitOptions = {}) {
    super();
    this.rng = o.rng ?? new Rng();
    this.o = {
      c1Threshold: o.c1Threshold ?? 200,
      c2Threshold: o.c2Threshold ?? 5000,
      c1Seconds: o.c1Seconds ?? 0.9,
      c2Seconds: o.c2Seconds ?? 2.2,
      deoptRate: o.deoptRate ?? 0.003,
    };
    this.methods = METHODS.map((m, index) => ({ ...m, index, tier: 0, invocations: 0, compiling: null, deopts: 0 }));
    this.codeCache = {
      // Stubs and adapters the JVM generates for itself at startup.
      nonNmethod: Array.from({ length: SEGMENT_SLOTS.nonNmethod }, (_, slot) => ({
        method: -1,
        tier: 3 as const,
        segment: 'nonNmethod' as const,
        slot,
        notEntrant: false,
        installedAt: 0,
      })),
      profiled: new Array<NMethod | null>(SEGMENT_SLOTS.profiled).fill(null),
      nonProfiled: new Array<NMethod | null>(SEGMENT_SLOTS.nonProfiled).fill(null),
    };
  }

  /** Picks a method the way running code would: hot ones more often. */
  pickMethod(): Method {
    const total = this.methods.reduce((s, m) => s + m.weight, 0);
    let r = this.rng.next() * total;
    for (const m of this.methods) if ((r -= m.weight) < 0) return m;
    return this.methods[this.methods.length - 1];
  }

  invoke(method: number, count = 1): void {
    const m = this.methods[method];
    m.invocations += count;
    if (m.compiling !== null) return;
    if (m.tier === 0 && m.invocations >= this.o.c1Threshold) this.enqueue(m, 3);
    else if (m.tier === 3 && m.invocations >= this.o.c2Threshold) this.enqueue(m, 4);
  }

  /** Makes the next still-interpreted (or C1) method hot at once. */
  heatUp(): Method | null {
    const m = this.methods.find((x) => x.tier === 0 && x.compiling === null) ?? this.methods.find((x) => x.tier === 3 && x.compiling === null);
    if (!m) return null;
    this.invoke(m.index, (m.tier === 0 ? this.o.c1Threshold : this.o.c2Threshold) - m.invocations + 1);
    return m;
  }

  /** A speculation failed: throw the C2 code away and go back to the interpreter. */
  deoptimize(method?: number): Method | null {
    const hot = this.methods.filter((x) => x.tier === 4);
    const m = method !== undefined ? this.methods[method] : hot.length ? this.rng.pick(hot) : undefined;
    if (!m || m.tier !== 4) return null;
    this.markNotEntrant(m.index);
    m.tier = 0;
    m.invocations = Math.floor(this.o.c1Threshold * 0.5);
    m.deopts++;
    this.totalDeopts++;
    this.emit('deopt', { method: m.index });
    return m;
  }

  countTier(t: Tier): number {
    return this.methods.filter((m) => m.tier === t).length;
  }

  step(dt: number): void {
    this.now += dt;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const job = this.queue[i];
      if (this.now >= job.doneAt) {
        this.queue.splice(i, 1);
        this.install(job.method, job.tier);
      }
    }
    for (const seg of ['profiled', 'nonProfiled'] as const) {
      const slots = this.codeCache[seg];
      slots.forEach((nm, i) => {
        if (nm?.flushAt !== undefined && this.now >= nm.flushAt) slots[i] = null;
      });
    }
    for (const m of this.methods) if (m.tier === 4 && this.rng.chance(this.o.deoptRate * dt)) this.deoptimize(m.index);
  }

  private enqueue(m: Method, tier: 3 | 4): void {
    m.compiling = tier;
    this.queue.push({ method: m.index, tier, doneAt: this.now + (tier === 3 ? this.o.c1Seconds : this.o.c2Seconds) });
    this.emit('compileStart', { method: m.index, tier });
  }

  private install(method: number, tier: 3 | 4): void {
    const m = this.methods[method];
    m.compiling = null;
    const segment = segmentOf(tier);
    const slots = this.codeCache[segment];
    const slot = slots.findIndex((s) => s === null);
    if (slot < 0) return; // code cache full: the JIT simply stops compiling
    this.markNotEntrant(method);
    const nm: NMethod = { method, tier, segment, slot, notEntrant: false, installedAt: this.now };
    slots[slot] = nm;
    m.tier = tier;
    this.emit('installed', nm);
  }

  private markNotEntrant(method: number): void {
    for (const seg of ['profiled', 'nonProfiled'] as const)
      for (const nm of this.codeCache[seg])
        if (nm && nm.method === method && !nm.notEntrant) {
          nm.notEntrant = true;
          nm.flushAt = this.now + FLUSH_DELAY;
        }
  }
}
