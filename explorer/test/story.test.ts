import { describe, expect, it } from 'vitest';
import { HOTSPOTS } from '../src/content';
import { JvmSim } from '../src/sim/jvm';
import { MOMENTS, Story, type MomentId } from '../src/story';

const run = (j: JvmSim, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 30) j.step(1 / 30);
};

describe('Story', () => {
  it('explains each kind of event exactly once, as it happens', () => {
    const sim = new JvmSim({ seed: 11 });
    const fired: MomentId[] = [];
    new Story(sim, (m) => fired.push(m.id));
    run(sim, 90);
    expect(new Set(fired).size).toBe(fired.length);
    for (const id of ['classLoaded', 'c1', 'c2', 'youngGc', 'park'] as const) expect(fired).toContain(id);
  });

  it('explains ZGC once the collector is switched', () => {
    const sim = new JvmSim({ seed: 12 });
    const fired: MomentId[] = [];
    new Story(sim, (m) => fired.push(m.id));
    sim.collector = 'ZGC';
    sim.heap.requestGc();
    run(sim, 5);
    expect(fired).toContain('zgc');
    expect(fired).not.toContain('youngGc');
  });

  it('stays quiet while disabled, and tells the story later', () => {
    const sim = new JvmSim({ seed: 13 });
    const fired: MomentId[] = [];
    let on = false;
    const story = new Story(sim, (m) => fired.push(m.id), () => on);
    run(sim, 10);
    expect(fired).toEqual([]);
    expect(story.has('classLoaded')).toBe(false);
    on = true;
    run(sim, 10);
    expect(fired).toContain('classLoaded');
  });

  it('tells the welcome on demand, once', () => {
    const sim = new JvmSim({ seed: 14 });
    const fired: MomentId[] = [];
    const story = new Story(sim, (m) => fired.push(m.id));
    story.tell('welcome');
    story.tell('welcome');
    expect(fired).toEqual(['welcome']);
  });

  it('points every moment at a real hotspot', () => {
    for (const m of Object.values(MOMENTS)) expect(HOTSPOTS[m.hotspot]).toBeDefined();
  });
});
