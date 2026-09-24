// A toy G1-style heap: equal-sized regions with roles, bump allocation into
// Eden, and young/mixed collections that copy live objects out. With ZGC the
// same work happens concurrently, and only the tiny pauses stop the world.
// Pure logic, no rendering: the view reads this state every frame.

import { Emitter } from './emitter';
import { Rng } from './rng';

export type RegionRole = 'free' | 'eden' | 'survivor' | 'old' | 'humongous';
export type Collector = 'G1' | 'ZGC';
export type GcPhase = 'idle' | 'mark' | 'evacuate';

export const HEAP_COLS = 10;
export const HEAP_ROWS = 6;
export const REGION_COUNT = HEAP_COLS * HEAP_ROWS;
/** Objects one region can hold (the view draws them as a 4x4x2 block). */
export const REGION_SLOTS = 32;
/** The fixed run of regions taken by one humongous array. */
export const HUMONGOUS_REGIONS: readonly number[] = [8, 9];

export interface Region {
  readonly index: number;
  role: RegionRole;
  /** Slot -> object, `null` when empty. */
  readonly slots: (HeapObject | null)[];
  /** Next slot to bump-allocate into. */
  top: number;
}

export interface Location {
  region: number;
  slot: number;
}

export interface HeapObject extends Location {
  readonly id: number;
  readonly klass: number;
  readonly size: number;
  age: number;
  readonly bornAt: number;
  readonly diesAt: number;
  /** Set while the object is being copied during evacuation. */
  movedFrom?: Location;
}

export interface GcEvent {
  kind: 'young' | 'mixed';
  collector: Collector;
  pauseMs: number;
  reclaimed: number;
  promoted: number;
}

export interface AllocRequest {
  klass: number;
  size: number;
  /** Lifetime in seconds; drawn from the default demographics if omitted. */
  lifetime?: number;
}

export interface HeapOptions {
  rng?: Rng;
  collector?: Collector;
  /** Young collection triggers once this many regions are Eden. */
  edenTarget?: number;
  /** Age at which survivors are promoted to Old. */
  tenuringThreshold?: number;
  /** Old region count from which collections become mixed. */
  mixedThreshold?: number;
  markSeconds?: number;
  evacuateSeconds?: number;
}

type HeapEvents = { gcStart: { kind: GcEvent['kind']; collector: Collector }; gcEnd: GcEvent };

/** ZGC still has a couple of tiny pauses; this is how long we show them. */
const ZGC_PAUSE_WINDOW = 0.12;

export class HeapSim extends Emitter<HeapEvents> {
  readonly regions: Region[];
  collector: Collector;
  now = 0;
  phase: GcPhase = 'idle';
  /** 0..1 progress through the current GC phase. */
  phaseProgress = 0;
  /** Regions being collected in the current cycle. */
  readonly cset = new Set<number>();
  gcCount = 0;
  lastGc: GcEvent | null = null;
  stalls = 0;

  private readonly rng: Rng;
  private readonly opts: Required<Omit<HeapOptions, 'rng' | 'collector'>>;
  private nextId = 1;
  private allocRegion = -1;
  private phaseTime = 0;
  private gcRequested = false;
  private cycle: { kind: GcEvent['kind']; reclaimed: number; promoted: number } | null = null;

  constructor(o: HeapOptions = {}) {
    super();
    this.rng = o.rng ?? new Rng();
    this.collector = o.collector ?? 'G1';
    this.opts = {
      edenTarget: o.edenTarget ?? 14,
      tenuringThreshold: o.tenuringThreshold ?? 3,
      mixedThreshold: o.mixedThreshold ?? 9,
      markSeconds: o.markSeconds ?? 1.1,
      evacuateSeconds: o.evacuateSeconds ?? 1.3,
    };
    this.regions = Array.from({ length: REGION_COUNT }, (_, index) => ({
      index,
      role: 'free' as RegionRole,
      slots: new Array<HeapObject | null>(REGION_SLOTS).fill(null),
      top: 0,
    }));
    for (const i of HUMONGOUS_REGIONS) this.regions[i].role = 'humongous';
  }

  // ------------------------------------------------------------- queries

  get isCollecting(): boolean {
    return this.phase !== 'idle';
  }

  /** True while application threads must be stopped at a safepoint. */
  get stopTheWorld(): boolean {
    if (this.phase === 'idle') return false;
    if (this.collector === 'G1') return true;
    const t = this.phaseProgress * this.phaseDuration();
    return t < ZGC_PAUSE_WINDOW;
  }

  isDead(o: HeapObject): boolean {
    return this.now >= o.diesAt;
  }

  countRole(role: RegionRole): number {
    return this.regions.reduce((n, r) => n + (r.role === role ? 1 : 0), 0);
  }

  *objects(): Generator<HeapObject> {
    for (const r of this.regions) for (const o of r.slots) if (o) yield o;
  }

  objectAt(region: number, slot: number): HeapObject | null {
    return this.regions[region]?.slots[slot] ?? null;
  }

  // ------------------------------------------------------------- mutation

  requestGc(): void {
    this.gcRequested = true;
  }

  /** Default object demographics: most die young, a few live long. */
  lifetime(): number {
    const r = this.rng.next();
    if (r < 0.82) return this.rng.range(0.5, 7);
    if (r < 0.96) return this.rng.range(8, 30);
    return this.rng.range(40, 140);
  }

  /** Bump-allocates into Eden. Returns null when the heap is full (an allocation stall). */
  allocate(req: AllocRequest): HeapObject | null {
    let region = this.regions[this.allocRegion];
    if (!region || region.role !== 'eden' || region.top >= REGION_SLOTS || this.cset.has(region.index)) {
      const fresh = this.claimFree('eden');
      if (!fresh) {
        this.stalls++;
        this.requestGc();
        return null;
      }
      this.allocRegion = fresh.index;
      region = fresh;
    }
    const obj: HeapObject = {
      id: this.nextId++,
      klass: req.klass,
      size: req.size,
      age: 0,
      bornAt: this.now,
      diesAt: this.now + (req.lifetime ?? this.lifetime()),
      region: region.index,
      slot: region.top,
    };
    region.slots[region.top++] = obj;
    return obj;
  }

  step(dt: number): void {
    this.now += dt;
    if (this.phase === 'idle') {
      const edenFull = this.countRole('eden') >= this.opts.edenTarget;
      const lowOnSpace = this.countRole('free') < 4;
      if (this.gcRequested || edenFull || lowOnSpace) this.startCycle();
      return;
    }
    this.phaseTime += dt;
    this.phaseProgress = Math.min(1, this.phaseTime / this.phaseDuration());
    if (this.phaseProgress < 1) return;
    if (this.phase === 'mark') this.finishMark();
    else this.finishEvacuate();
  }

  // ------------------------------------------------------------- GC cycle

  private phaseDuration(): number {
    return this.phase === 'mark' ? this.opts.markSeconds : this.opts.evacuateSeconds;
  }

  private startCycle(): void {
    this.gcRequested = false;
    this.cset.clear();
    for (const r of this.regions) if (r.role === 'eden' || r.role === 'survivor') this.cset.add(r.index);
    let kind: GcEvent['kind'] = 'young';
    const olds = this.regions.filter((r) => r.role === 'old');
    if (olds.length >= this.opts.mixedThreshold || this.countRole('free') < 6) {
      // Garbage first: the old regions with the highest share of dead objects.
      const garbage = (r: Region) => r.slots.filter((o) => o && this.isDead(o)).length;
      olds
        .map((r) => ({ r, g: garbage(r) }))
        .filter((x) => x.g > 0)
        .sort((a, b) => b.g - a.g)
        .slice(0, 3)
        .forEach((x) => this.cset.add(x.r.index));
      if (olds.some((r) => this.cset.has(r.index))) kind = 'mixed';
    }
    this.allocRegion = -1;
    this.cycle = { kind, reclaimed: 0, promoted: 0 };
    this.enterPhase('mark');
    this.emit('gcStart', { kind, collector: this.collector });
  }

  private enterPhase(p: GcPhase): void {
    this.phase = p;
    this.phaseTime = 0;
    this.phaseProgress = 0;
  }

  /** Marking done: everything unreachable in the collection set is reclaimed. */
  private finishMark(): void {
    for (const i of this.cset) {
      const r = this.regions[i];
      r.slots.forEach((o, s) => {
        if (o && this.isDead(o)) {
          r.slots[s] = null;
          this.cycle!.reclaimed++;
        }
      });
    }
    // Copy the survivors out, ageing them; old enough ones are promoted.
    const survivors: HeapObject[] = [];
    for (const i of this.cset) for (const o of this.regions[i].slots) if (o) survivors.push(o);
    for (const o of survivors) {
      const fromRole = this.regions[o.region].role;
      const promote = fromRole === 'old' || o.age + 1 >= this.opts.tenuringThreshold;
      const dest = this.bumpInto(promote ? 'old' : 'survivor');
      if (!dest) continue; // evacuation failure: the object stays where it is
      const from = { region: o.region, slot: o.slot };
      this.regions[from.region].slots[from.slot] = null;
      o.age = fromRole === 'old' ? o.age : o.age + 1;
      o.region = dest.region;
      o.slot = dest.slot;
      o.movedFrom = from;
      this.regions[dest.region].slots[dest.slot] = o;
      if (promote && fromRole !== 'old') this.cycle!.promoted++;
    }
    this.enterPhase('evacuate');
  }

  private finishEvacuate(): void {
    for (const o of this.objects()) delete o.movedFrom;
    for (const i of this.cset) {
      const r = this.regions[i];
      if (r.slots.every((s) => s === null)) this.release(r);
    }
    this.cset.clear();
    const c = this.cycle!;
    const pauseMs =
      this.collector === 'G1' ? Math.round(this.rng.range(6, 18) * 10) / 10 : Math.round(this.rng.range(0.02, 0.2) * 100) / 100;
    const ev: GcEvent = { kind: c.kind, collector: this.collector, pauseMs, reclaimed: c.reclaimed, promoted: c.promoted };
    this.cycle = null;
    this.gcCount++;
    this.lastGc = ev;
    this.enterPhase('idle');
    this.emit('gcEnd', ev);
  }

  // ------------------------------------------------------------- regions

  /** Takes a free region; like G1's free list, roles end up scattered across the heap. */
  private claimFree(role: RegionRole): Region | null {
    const free = this.regions.filter((x) => x.role === 'free');
    if (free.length === 0) return null;
    const r = this.rng.pick(free);
    r.role = role;
    r.top = 0;
    return r;
  }

  private release(r: Region): void {
    r.role = 'free';
    r.top = 0;
    r.slots.fill(null);
  }

  /** Finds room in a (non-collected) region of `role`, claiming a free one if needed. */
  private bumpInto(role: 'survivor' | 'old'): Location | null {
    let r = this.regions.find((x) => x.role === role && !this.cset.has(x.index) && x.top < REGION_SLOTS);
    r ??= this.claimFree(role) ?? undefined;
    if (!r) return null;
    return { region: r.index, slot: r.top++ };
  }
}
