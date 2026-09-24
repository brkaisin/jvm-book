// The whole toy JVM: class loading, threads calling methods (which feeds the
// JIT) and allocating objects (which feeds the heap and triggers the GC).

import { HeapSim, type Collector, type HeapOptions } from './heap';
import { JitSim, type JitOptions } from './jit';
import { Rng } from './rng';
import { ThreadSim } from './threads';
import { Emitter } from './emitter';

export type Loader = 'bootstrap' | 'platform' | 'app';

export interface Klass {
  readonly name: string;
  readonly loader: Loader;
  /** Instance size in bytes (compact headers). */
  readonly size: number;
  /** How often instances get allocated, relative to the others. */
  readonly allocWeight: number;
  /** Only the Code Lab loads and allocates it. */
  readonly lab?: true;
}

export const KLASSES: readonly Klass[] = [
  { name: 'java.lang.Object', loader: 'bootstrap', size: 8, allocWeight: 0.5 },
  { name: 'java.lang.String', loader: 'bootstrap', size: 24, allocWeight: 6 },
  { name: 'java.lang.Thread', loader: 'bootstrap', size: 128, allocWeight: 0.1 },
  { name: 'byte[]', loader: 'bootstrap', size: 48, allocWeight: 5 },
  { name: 'java.util.HashMap$Node', loader: 'bootstrap', size: 32, allocWeight: 3 },
  { name: 'java.util.ArrayList', loader: 'bootstrap', size: 24, allocWeight: 2 },
  { name: 'java.lang.Integer', loader: 'bootstrap', size: 16, allocWeight: 3 },
  { name: 'java.sql.Timestamp', loader: 'platform', size: 32, allocWeight: 0.6 },
  { name: 'java.net.http.HttpRequest', loader: 'platform', size: 40, allocWeight: 0.8 },
  { name: 'shop.Shop$', loader: 'app', size: 16, allocWeight: 0.1 },
  { name: 'shop.Order', loader: 'app', size: 32, allocWeight: 3 },
  { name: 'shop.LineItem', loader: 'app', size: 24, allocWeight: 3 },
  { name: 'shop.Customer', loader: 'app', size: 40, allocWeight: 1 },
  { name: 'shop.Money', loader: 'app', size: 24, allocWeight: 2.5 },
  { name: 'shop.Router', loader: 'app', size: 24, allocWeight: 0.2 },
  { name: 'shop.Json$Parser', loader: 'app', size: 56, allocWeight: 1 },
  { name: 'shop.Point', loader: 'app', size: 24, allocWeight: 1.5 },
  { name: 'shop.Checkout$$Lambda', loader: 'app', size: 16, allocWeight: 1.5 },
  // Only loaded on demand (when the visitor asks for more classes).
  { name: 'shop.Invoice', loader: 'app', size: 40, allocWeight: 1 },
  { name: 'java.time.LocalDate', loader: 'bootstrap', size: 24, allocWeight: 1 },
  { name: 'shop.Discount', loader: 'app', size: 24, allocWeight: 1 },
  { name: 'java.util.stream.ReferencePipeline', loader: 'bootstrap', size: 48, allocWeight: 0.5 },
  { name: 'java.sql.Connection', loader: 'platform', size: 64, allocWeight: 0.2 },
  { name: 'shop.Report', loader: 'app', size: 32, allocWeight: 0.8 },
  // The classes of the program written in the Code Lab.
  { name: 'Main (your code)', loader: 'app', size: 16, allocWeight: 0, lab: true },
];

/** Index of the Code Lab's class in KLASSES. */
export const LAB_KLASS = KLASSES.findIndex((k) => k.lab);

/** Classes already there when the JVM finishes booting. */
export const PRELOADED = 7;
/** Classes the program loads by itself over time; the rest load on demand. */
export const AUTO_LOADED = 18;

export type KlassState = 'unloaded' | 'loading' | 'loaded';

export interface ClassLoadJob {
  readonly klass: number;
  readonly startedAt: number;
}

export interface Stats {
  heapUsedBytes: number;
  regions: Record<'free' | 'eden' | 'survivor' | 'old' | 'humongous', number>;
  collector: Collector;
  gcCount: number;
  lastPauseMs: number | null;
  classesLoaded: number;
  c1: number;
  c2: number;
  deopts: number;
  vthreads: number;
  vMounted: number;
  vParked: number;
  allocated: number;
}

export interface JvmOptions {
  seed?: number;
  heap?: HeapOptions;
  jit?: JitOptions;
  /** Objects allocated per second while threads run. */
  allocRate?: number;
  /** Invocations each visible call stands for. */
  callWeight?: number;
  /** Seconds a class file takes to travel through loading and linking. */
  loadSeconds?: number;
  /** Seconds between two class loads. */
  loadInterval?: number;
}

type JvmEvents = { classLoaded: { klass: number } };

export class JvmSim extends Emitter<JvmEvents> {
  readonly rng: Rng;
  readonly heap: HeapSim;
  readonly jit: JitSim;
  readonly threads: ThreadSim;
  readonly klassState: KlassState[];
  readonly loading: ClassLoadJob[] = [];
  now = 0;
  paused = false;
  allocated = 0;

  private allocDebt = 0;
  private nextLoadAt = 1;
  private readonly allocRate: number;
  private readonly callWeight: number;
  readonly loadSeconds: number;
  private readonly loadInterval: number;

  constructor(o: JvmOptions = {}) {
    super();
    this.rng = new Rng(o.seed);
    this.heap = new HeapSim({ rng: this.rng, ...o.heap });
    this.jit = new JitSim({ rng: this.rng, ...o.jit });
    this.threads = new ThreadSim({ rng: this.rng, pickMethod: () => this.jit.pickMethod().index });
    this.threads.on('call', (e) => this.jit.invoke(e.method, this.callWeight));
    this.allocRate = o.allocRate ?? 42;
    this.callWeight = o.callWeight ?? 120;
    this.loadSeconds = o.loadSeconds ?? 3.2;
    this.loadInterval = o.loadInterval ?? 3.6;
    this.klassState = KLASSES.map((_, i) => (i < PRELOADED ? 'loaded' : 'unloaded'));
  }

  get collector(): Collector {
    return this.heap.collector;
  }

  set collector(c: Collector) {
    this.heap.collector = c;
  }

  get safepoint(): boolean {
    return this.heap.stopTheWorld;
  }

  loadedKlasses(): number[] {
    return this.klassState.flatMap((s, i) => (s === 'loaded' ? [i] : []));
  }

  step(dt: number): void {
    if (this.paused) return;
    this.now += dt;
    const frozen = this.heap.stopTheWorld;
    this.threads.step(dt, frozen);
    this.jit.step(dt);
    this.stepClassLoading();
    if (!frozen) this.allocate(dt);
    this.heap.step(dt);
  }

  private stepClassLoading(): void {
    for (let i = this.loading.length - 1; i >= 0; i--) {
      const job = this.loading[i];
      if (this.now - job.startedAt >= this.loadSeconds) {
        this.loading.splice(i, 1);
        this.klassState[job.klass] = 'loaded';
        this.emit('classLoaded', { klass: job.klass });
      }
    }
    if (this.now < this.nextLoadAt) return;
    const next = this.klassState.indexOf('unloaded');
    if (next < 0 || next >= AUTO_LOADED) return;
    this.startLoading(next);
    this.nextLoadAt = this.now + this.loadInterval;
  }

  /** Starts loading the next class that is not loaded yet; null if all are. */
  loadClass(): number | null {
    const next = this.klassState.findIndex((s, i) => s === 'unloaded' && !KLASSES[i].lab);
    if (next < 0) return null;
    this.startLoading(next);
    return next;
  }

  /** Loads class `k` if it is not loaded yet (the Code Lab loads its own class this way). */
  loadKlass(k: number): void {
    if (this.klassState[k] === 'unloaded') this.startLoading(k);
  }

  private startLoading(k: number): void {
    this.klassState[k] = 'loading';
    this.loading.push({ klass: k, startedAt: this.now });
  }

  /** Allocates `n` objects right away; returns how many fit before the heap was full. */
  allocateNow(n: number): number {
    let done = 0;
    while (done < n && this.allocateOne()) done++;
    return done;
  }

  private allocate(dt: number): void {
    this.allocDebt += dt * this.allocRate;
    while (this.allocDebt >= 1) {
      this.allocDebt -= 1;
      if (!this.allocateOne()) {
        this.allocDebt = 0; // allocation stall: wait for the GC
        break;
      }
    }
  }

  /** One allocation of a loaded class, picked by how often the program uses it. */
  private allocateOne(): boolean {
    const loaded = this.loadedKlasses();
    const total = loaded.reduce((s, k) => s + KLASSES[k].allocWeight, 0);
    let r = this.rng.next() * total;
    const klass = loaded.find((k) => KLASSES[k].allocWeight > 0 && (r -= KLASSES[k].allocWeight) < 0) ?? loaded[0];
    if (!this.heap.allocate({ klass, size: KLASSES[klass].size })) return false;
    this.allocated++;
    return true;
  }

  stats(): Stats {
    const h = this.heap;
    let used = 0;
    for (const o of h.objects()) used += o.size;
    const last = h.lastGc;
    return {
      heapUsedBytes: used,
      regions: {
        free: h.countRole('free'),
        eden: h.countRole('eden'),
        survivor: h.countRole('survivor'),
        old: h.countRole('old'),
        humongous: h.countRole('humongous'),
      },
      collector: h.collector,
      gcCount: h.gcCount,
      lastPauseMs: last ? last.pauseMs : null,
      classesLoaded: this.klassState.filter((s) => s === 'loaded').length,
      c1: this.jit.countTier(3),
      c2: this.jit.countTier(4),
      deopts: this.jit.totalDeopts,
      vthreads: this.threads.vthreads.length,
      vMounted: this.threads.countVthreads('mounted'),
      vParked: this.threads.countVthreads('parked'),
      allocated: this.allocated,
    };
  }
}
