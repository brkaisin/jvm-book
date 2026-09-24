import { describe, expect, it } from 'vitest';
import { HeapSim, HUMONGOUS_REGIONS, REGION_COUNT, REGION_SLOTS, type GcEvent } from '../src/sim/heap';
import { Rng } from '../src/sim/rng';

const heap = (o: ConstructorParameters<typeof HeapSim>[0] = {}) => new HeapSim({ rng: new Rng(42), ...o });

/** Runs the heap until the current GC cycle (if any) is over. */
function finishCycle(h: HeapSim) {
  for (let i = 0; i < 1000 && h.isCollecting; i++) h.step(0.05);
}

describe('HeapSim', () => {
  it('starts with only humongous regions in use', () => {
    const h = heap();
    expect(h.countRole('humongous')).toBe(HUMONGOUS_REGIONS.length);
    expect(h.countRole('free')).toBe(REGION_COUNT - HUMONGOUS_REGIONS.length);
  });

  it('bump-allocates into one Eden region until it is full', () => {
    const h = heap();
    const objs = Array.from({ length: REGION_SLOTS + 1 }, () => h.allocate({ klass: 0, size: 16 })!);
    expect(new Set(objs.slice(0, REGION_SLOTS).map((o) => o.region)).size).toBe(1);
    expect(objs.slice(0, REGION_SLOTS).map((o) => o.slot)).toEqual([...Array(REGION_SLOTS).keys()]);
    expect(objs[REGION_SLOTS].region).not.toBe(objs[0].region);
    expect(h.countRole('eden')).toBe(2);
  });

  it('a young GC reclaims dead objects and copies live ones to Survivor regions', () => {
    const h = heap();
    const dying = Array.from({ length: 20 }, () => h.allocate({ klass: 0, size: 16, lifetime: 0.1 })!);
    const living = Array.from({ length: 5 }, () => h.allocate({ klass: 1, size: 16, lifetime: 999 })!);
    const events: GcEvent[] = [];
    h.on('gcEnd', (e) => events.push(e));
    h.step(0.5);
    h.requestGc();
    h.step(0.01);
    expect(h.phase).toBe('mark');
    finishCycle(h);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'young', reclaimed: 20, promoted: 0 });
    expect(h.countRole('eden')).toBe(0);
    for (const o of living) {
      expect(h.regions[o.region].role).toBe('survivor');
      expect(o.age).toBe(1);
      expect(h.objectAt(o.region, o.slot)).toBe(o);
    }
    for (const o of dying) expect(h.objectAt(o.region, o.slot)).not.toBe(o);
  });

  it('promotes objects that reach the tenuring threshold to Old', () => {
    const h = heap({ tenuringThreshold: 2 });
    const o = h.allocate({ klass: 0, size: 16, lifetime: 999 })!;
    for (let i = 0; i < 2; i++) {
      h.requestGc();
      h.step(0.01);
      finishCycle(h);
    }
    expect(o.age).toBe(2);
    expect(h.regions[o.region].role).toBe('old');
    expect(h.lastGc?.promoted).toBe(1);
  });

  it('stops the world for the whole G1 cycle but only briefly with ZGC', () => {
    const sample = (collector: 'G1' | 'ZGC') => {
      const h = heap({ collector });
      h.allocate({ klass: 0, size: 16 });
      h.requestGc();
      let stw = 0;
      let total = 0;
      h.step(0.01);
      while (h.isCollecting) {
        total++;
        if (h.stopTheWorld) stw++;
        h.step(0.01);
      }
      return stw / total;
    };
    expect(sample('G1')).toBe(1);
    expect(sample('ZGC')).toBeLessThan(0.15);
  });

  it('never allocates into a region that is being collected', () => {
    const h = heap({ collector: 'ZGC' });
    for (let i = 0; i < 40; i++) h.allocate({ klass: 0, size: 16 });
    h.requestGc();
    h.step(0.01);
    const o = h.allocate({ klass: 0, size: 16 })!;
    expect(h.cset.has(o.region)).toBe(false);
  });

  it('stays within its regions over a long run (mixed collections keep Old in check)', () => {
    const h = heap();
    let mixed = 0;
    h.on('gcEnd', (e) => (mixed += e.kind === 'mixed' ? 1 : 0));
    for (let t = 0; t < 600; t += 0.05) {
      if (!h.stopTheWorld) for (let k = 0; k < 2; k++) h.allocate({ klass: 0, size: 16 });
      h.step(0.05);
      expect(h.countRole('humongous')).toBe(2);
    }
    expect(h.gcCount).toBeGreaterThan(20);
    expect(mixed).toBeGreaterThan(0);
    expect(h.countRole('free')).toBeGreaterThan(0);
    // Every object sits where it says it does.
    for (const o of h.objects()) expect(h.objectAt(o.region, o.slot)).toBe(o);
  });
});
