// "What just happened?": the first time something noteworthy happens in the
// simulation, explain it. Pure logic on top of the simulation's events; the
// UI decides how to show a moment.

import type { HotspotId } from './content';
import type { JvmSim } from './sim/jvm';

export type MomentId = 'welcome' | 'classLoaded' | 'c1' | 'c2' | 'youngGc' | 'promotion' | 'mixedGc' | 'zgc' | 'deopt' | 'park';

export interface Moment {
  id: MomentId;
  title: string;
  /** HTML. */
  text: string;
  hotspot: HotspotId;
}

export const MOMENTS: Record<MomentId, Omit<Moment, 'id'>> = {
  welcome: {
    title: 'Welcome inside a running JVM',
    text: '<b>Hover</b> anything to see what it is, <b>click</b> it to learn more. Press <kbd>K</kbd> for the colour legend, or <kbd>T</kbd> for a guided tour. Cards like this one will explain important events the first time they happen.',
    hotspot: 'jvm',
  },
  classLoaded: {
    title: 'A class was just loaded',
    text: 'A gold class file crossed the loader rings and the verifier, and a new crystal lit up in Metaspace. Classes are loaded lazily: only when the program first needs them.',
    hotspot: 'classloaders',
  },
  c1: {
    title: 'The JIT compiled its first method',
    text: 'A method was called often enough to get warm: a green spark flew from the interpreter to C1, and a green block landed in the code cache. Stack frames running it now glow green.',
    hotspot: 'c1',
  },
  c2: {
    title: 'A method is now fully optimised',
    text: 'A method got really hot: C2 recompiled it using the profile C1 collected. Its frames turn orange, and the old C1 code blinks red before being thrown away.',
    hotspot: 'c2',
  },
  youngGc: {
    title: 'That was a garbage collection',
    text: 'Eden filled up, so G1 stopped every thread at a safepoint (the towers froze in ice), swept the young regions, and copied the few live objects to Survivor regions. Everything grey was simply dropped.',
    hotspot: 'gc',
  },
  promotion: {
    title: 'Objects were promoted to Old',
    text: 'Some objects survived enough collections that G1 moved them to Old (pink) regions: they look long-lived, so young collections stop copying them back and forth.',
    hotspot: 'old',
  },
  mixedGc: {
    title: 'A mixed collection',
    text: 'Old regions were piling up garbage, so G1 added the ones with the most garbage to this young collection. That is the “garbage first” in its name.',
    hotspot: 'old',
  },
  zgc: {
    title: 'ZGC collected without stopping you',
    text: 'The same work (mark, then move live objects) happened while the threads kept running. Only two tiny pauses, far below a millisecond, froze them.',
    hotspot: 'gc',
  },
  deopt: {
    title: 'Deoptimisation!',
    text: 'The C2 code made a bet based on the profile, and the bet just failed. The compiled code was thrown away (the red spark), and the method is back in the interpreter until it gets hot again.',
    hotspot: 'deopt',
  },
  park: {
    title: 'A virtual thread just blocked',
    text: 'It unmounted from its carrier, and its stack frames were saved in the heap (the dim light on the heap). The carrier is free and immediately picks up the next virtual thread from the queue.',
    hotspot: 'vthreads',
  },
};

/** Emits each moment the first time it happens, while `enabled()` says so. */
export class Story {
  private readonly seen = new Set<MomentId>();

  constructor(
    sim: JvmSim,
    private readonly onMoment: (m: Moment) => void,
    private readonly enabled: () => boolean = () => true,
  ) {
    sim.on('classLoaded', () => this.fire('classLoaded'));
    sim.jit.on('installed', (nm) => this.fire(nm.tier === 3 ? 'c1' : 'c2'));
    sim.jit.on('deopt', () => this.fire('deopt'));
    sim.heap.on('gcEnd', (e) => {
      if (e.collector === 'ZGC') this.fire('zgc');
      else if (e.kind === 'mixed') this.fire('mixedGc');
      else this.fire('youngGc');
      if (e.promoted > 0) this.fire('promotion');
    });
    sim.threads.on('unmount', (e) => {
      if (!e.finished) this.fire('park');
    });
  }

  /** Tells a moment that is not tied to a simulation event (like the welcome). */
  tell(id: MomentId): void {
    this.fire(id);
  }

  has(id: MomentId): boolean {
    return this.seen.has(id);
  }

  private fire(id: MomentId): void {
    if (this.seen.has(id) || !this.enabled()) return;
    this.seen.add(id);
    this.onMoment({ id, ...MOMENTS[id] });
  }
}
