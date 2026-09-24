import { describe, expect, it } from 'vitest';
import { JvmSim, KLASSES, PRELOADED } from '../src/sim/jvm';

const run = (j: JvmSim, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 30) j.step(1 / 30);
};

describe('JvmSim', () => {
  it('is deterministic for a given seed', () => {
    const a = new JvmSim({ seed: 5 });
    const b = new JvmSim({ seed: 5 });
    run(a, 20);
    run(b, 20);
    expect(a.stats()).toEqual(b.stats());
  });

  it('loads classes lazily, one after the other', () => {
    const j = new JvmSim({ seed: 1, loadInterval: 1, loadSeconds: 0.5 });
    expect(j.stats().classesLoaded).toBe(PRELOADED);
    run(j, 5);
    const n = j.stats().classesLoaded;
    expect(n).toBeGreaterThan(PRELOADED);
    expect(n).toBeLessThan(KLASSES.length);
    run(j, 30);
    expect(j.stats().classesLoaded).toBe(KLASSES.length);
  });

  it('only allocates instances of loaded classes', () => {
    const j = new JvmSim({ seed: 2 });
    run(j, 3);
    const loaded = new Set(j.loadedKlasses());
    for (const o of j.heap.objects()) expect(loaded.has(o.klass)).toBe(true);
  });

  it('warms up: after a while the JIT has compiled hot methods and the GC has run', () => {
    const j = new JvmSim({ seed: 3 });
    run(j, 60);
    const s = j.stats();
    expect(s.gcCount).toBeGreaterThan(2);
    expect(s.c1 + s.c2).toBeGreaterThan(3);
    expect(s.c2).toBeGreaterThan(0);
  });

  it('does not allocate or run threads during a G1 pause', () => {
    const j = new JvmSim({ seed: 4 });
    run(j, 2);
    j.heap.requestGc();
    j.step(0.01);
    expect(j.safepoint).toBe(true);
    const before = j.allocated;
    const frames = JSON.stringify(j.threads.threads.map((t) => t.frames.length));
    j.step(0.2);
    expect(j.allocated).toBe(before);
    expect(JSON.stringify(j.threads.threads.map((t) => t.frames.length))).toBe(frames);
  });

  it('pausing freezes everything', () => {
    const j = new JvmSim({ seed: 6 });
    run(j, 1);
    j.paused = true;
    const s = j.stats();
    run(j, 5);
    expect(j.stats()).toEqual(s);
  });
});
