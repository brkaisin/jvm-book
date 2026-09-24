import { describe, expect, it } from 'vitest';
import { ThreadSim } from '../src/sim/threads';
import { Rng } from '../src/sim/rng';

const sim = (vthreads = 10) => new ThreadSim({ rng: new Rng(3), vthreads, pickMethod: () => 0 });
const run = (s: ThreadSim, seconds: number, frozen = false) => {
  for (let t = 0; t < seconds; t += 0.05) s.step(0.05, frozen);
};

describe('ThreadSim', () => {
  it('platform threads push and pop frames within bounds, calling methods', () => {
    const s = sim();
    let calls = 0;
    s.on('call', () => calls++);
    run(s, 30);
    expect(calls).toBeGreaterThan(50);
    for (const t of s.threads) expect(t.frames.length).toBeLessThanOrEqual(11);
  });

  it('a frozen (safepoint) step changes nothing', () => {
    const s = sim();
    run(s, 2);
    const snapshot = JSON.stringify(s.threads.map((t) => t.frames));
    run(s, 2, true);
    expect(JSON.stringify(s.threads.map((t) => t.frames))).toBe(snapshot);
  });

  it('mounts at most one virtual thread per carrier and keeps its stack while parked', () => {
    const s = sim();
    const unmounted = new Set<number>();
    s.on('unmount', (e) => unmounted.add(e.vthread.id));
    for (let t = 0; t < 20; t += 0.05) {
      s.step(0.05);
      const mounted = s.vthreads.filter((v) => v.state === 'mounted');
      expect(mounted.length).toBeLessThanOrEqual(s.carriers.length);
      for (const c of s.carriers) if (c.mounted) expect(c.frames).toBe(c.mounted.frames);
      for (const v of s.vthreads) if (v.state === 'parked') expect(v.frames.length).toBeGreaterThan(0);
    }
    expect(unmounted.size).toBeGreaterThan(3);
  });

  it('spawned virtual threads eventually finish; the long-lived ones stay', () => {
    const s = sim(4);
    expect(s.spawn(20)).toBe(20);
    run(s, 200);
    expect(s.vthreads).toHaveLength(4);
  });

  it('caps the number of virtual threads', () => {
    const s = new ThreadSim({ rng: new Rng(1), vthreads: 190, maxVthreads: 200, pickMethod: () => 0 });
    expect(s.spawn(64)).toBe(10);
  });
});
