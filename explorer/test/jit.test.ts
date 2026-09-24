import { describe, expect, it } from 'vitest';
import { JitSim, METHODS, SEGMENT_SLOTS } from '../src/sim/jit';
import { Rng } from '../src/sim/rng';

const jit = () => new JitSim({ rng: new Rng(7), c1Threshold: 10, c2Threshold: 100, c1Seconds: 1, c2Seconds: 2, deoptRate: 0 });
const run = (j: JitSim, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.1) j.step(0.1);
};

describe('JitSim', () => {
  it('every method starts in the interpreter', () => {
    const j = jit();
    expect(j.methods).toHaveLength(METHODS.length);
    expect(j.countTier(0)).toBe(METHODS.length);
  });

  it('climbs 0 -> 3 -> 4 as a method gets hot, after compile time', () => {
    const j = jit();
    const tiers: number[] = [];
    j.on('installed', (nm) => tiers.push(nm.tier));
    j.invoke(0, 10);
    expect(j.methods[0].compiling).toBe(3);
    expect(j.methods[0].tier).toBe(0);
    run(j, 1.1);
    expect(j.methods[0].tier).toBe(3);
    j.invoke(0, 100);
    run(j, 2.1);
    expect(j.methods[0].tier).toBe(4);
    expect(tiers).toEqual([3, 4]);
  });

  it('marks the C1 version not entrant once C2 code is installed, then flushes it', () => {
    const j = jit();
    j.invoke(0, 10);
    run(j, 1.1);
    j.invoke(0, 100);
    run(j, 2.1);
    const c1 = j.codeCache.profiled.find((nm) => nm?.method === 0)!;
    expect(c1.notEntrant).toBe(true);
    run(j, 2);
    expect(j.codeCache.profiled.some((nm) => nm?.method === 0)).toBe(false);
    expect(j.codeCache.nonProfiled.some((nm) => nm?.method === 0 && !nm.notEntrant)).toBe(true);
  });

  it('deoptimisation sends a C2 method back to the interpreter', () => {
    const j = jit();
    j.invoke(1, 10);
    run(j, 1.1);
    j.invoke(1, 100);
    run(j, 2.1);
    const events: number[] = [];
    j.on('deopt', (e) => events.push(e.method));
    expect(j.deoptimize()).toBe(j.methods[1]);
    expect(j.methods[1].tier).toBe(0);
    expect(events).toEqual([1]);
    expect(j.totalDeopts).toBe(1);
    expect(j.deoptimize()).toBeNull();
  });

  it('heatUp compiles interpreted methods first', () => {
    const j = jit();
    const m = j.heatUp()!;
    expect(m.compiling).toBe(3);
  });

  it('stops compiling when the code cache segment is full', () => {
    const j = new JitSim({ rng: new Rng(1), c1Threshold: 1, c1Seconds: 0 });
    j.codeCache.profiled.fill({ method: -1, tier: 3, segment: 'profiled', slot: 0, notEntrant: false, installedAt: 0 });
    j.invoke(0, 5);
    j.step(0.1);
    expect(j.methods[0].tier).toBe(0);
    expect(j.codeCache.profiled).toHaveLength(SEGMENT_SLOTS.profiled);
  });

  it('pickMethod favours heavy methods', () => {
    const j = jit();
    const counts = new Map<string, number>();
    for (let i = 0; i < 5000; i++) {
      const n = j.pickMethod().name;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    expect(counts.get('String.hashCode')!).toBeGreaterThan(counts.get('Config.load')! * 5);
  });
});
