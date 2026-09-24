import { describe, expect, it } from 'vitest';
import { SAMPLES } from '../src/lang';
import { LabRunner } from '../src/lab/labRunner';
import { JvmSim, LAB_KLASS } from '../src/sim/jvm';

const sample = (id: string) => SAMPLES.find((s) => s.id === id)!.code;

/** Runs the world and the lab together, like the page does. */
function run(sim: JvmSim, lab: LabRunner, seconds: number, dt = 1 / 30) {
  for (let t = 0; t < seconds && (lab.state === 'running' || lab.state === 'paused'); t += dt) {
    sim.step(dt);
    lab.update(dt);
  }
}

const setup = () => {
  const sim = new JvmSim({ seed: 31 });
  const lab = new LabRunner(sim);
  const out: string[] = [];
  lab.on('print', (t) => out.push(t));
  return { sim, lab, out };
};

describe('LabRunner', () => {
  it('reports compile errors instead of running', () => {
    const { lab } = setup();
    expect(lab.load('class Main { public static void main(String[] args) { int x = y; } }')).toBe(false);
    expect(lab.errors[0].line).toBe(1);
    expect(lab.state).toBe('empty');
  });

  it('runs a program to the end and loads its class', () => {
    const { sim, lab, out } = setup();
    lab.load(sample('fib'));
    lab.speed = 10_000;
    lab.run();
    run(sim, lab, 60);
    expect(lab.state).toBe('finished');
    expect(out.join('')).toContain('610');
    expect(sim.klassState[LAB_KLASS]).not.toBe('unloaded');
  });

  it('mirrors the call stack onto the lab thread', () => {
    const { sim, lab } = setup();
    lab.load(sample('fib'));
    lab.speed = 50;
    lab.run();
    let deepest = 0;
    for (let t = 0; t < 10; t += 1 / 30) {
      sim.step(1 / 30);
      lab.update(1 / 30);
      expect(sim.threads.lab.frames.length).toBe(lab.vm!.frames.length);
      deepest = Math.max(deepest, sim.threads.lab.frames.length);
    }
    expect(deepest).toBeGreaterThan(3);
  });

  it('single-steps one instruction at a time', () => {
    const { lab } = setup();
    lab.load(sample('stack'));
    lab.step();
    lab.step();
    expect(lab.vm!.executed).toBe(2);
    expect(lab.state).toBe('paused');
  });

  it('gets hot code compiled by the JIT, which then runs faster', () => {
    const { sim, lab } = setup();
    const compiled: string[] = [];
    lab.on('compiled', (e) => compiled.push(`${e.method}@${e.tier}`));
    lab.load(sample('hot'));
    lab.speed = 3000;
    lab.run();
    run(sim, lab, 20);
    expect(compiled.some((c) => c.endsWith('@3'))).toBe(true);
    expect(compiled.some((c) => c.endsWith('@4'))).toBe(true);
  });

  it("puts the program's objects in the heap, and the GC frees only unreachable ones", () => {
    const { sim, lab } = setup();
    lab.load(sample('survivors'));
    lab.speed = 10_000;
    lab.run();
    // Right after each mark (the lab listens first), only reachable objects are left.
    let marks = 0;
    sim.heap.on('gcStart', () => {
      marks++;
      expect(lab.liveObjects).toBeLessThanOrEqual(lab.vm!.reachable().size);
    });
    let maxLive = 0;
    for (let t = 0; t < 40 && lab.state === 'running'; t += 1 / 30) {
      sim.step(1 / 30);
      lab.update(1 / 30);
      maxLive = Math.max(maxLive, lab.liveObjects);
    }
    expect(marks).toBeGreaterThan(0);
    expect(maxLive).toBeGreaterThan(100);
    expect([...sim.heap.objects()].some((o) => o.klass === LAB_KLASS)).toBe(true);
  });

  it('crashes with a StackOverflowError, frames still in place', () => {
    const { sim, lab } = setup();
    const crashes: string[] = [];
    lab.on('crashed', (e) => crashes.push(e.name));
    lab.load(sample('overflow'));
    lab.speed = 10_000;
    lab.run();
    run(sim, lab, 10);
    expect(crashes).toEqual(['StackOverflowError']);
    expect(lab.state).toBe('crashed');
    expect(sim.threads.lab.frames.length).toBe(44);
  });

  it('freezes at a G1 safepoint like every other thread', () => {
    const { sim, lab } = setup();
    lab.load(sample('hot'));
    lab.run();
    sim.heap.requestGc();
    sim.step(0.01);
    expect(sim.safepoint).toBe(true);
    const before = lab.vm!.executed;
    lab.update(0.5);
    expect(lab.vm!.executed).toBe(before);
  });
});
