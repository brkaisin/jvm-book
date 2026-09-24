import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Narrator, type Line, type NarratorListener } from '../src/audio/narrator';

/** Records what the captions would show. (No speech engine in Node: captions only, timed.) */
class Captions implements NarratorListener {
  lines: { topic: string; interrupted: boolean }[] = [];
  current: string | null = null;
  waiting = 0;
  start(line: Line, _voiced: boolean, interrupted: boolean) {
    this.lines.push({ topic: line.topic, interrupted });
    this.current = line.topic;
  }
  word() {}
  end() {
    this.current = null;
  }
  queued(n: number) {
    this.waiting = n;
  }
}

describe('Narrator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lets the visitor interrupt, and says so', () => {
    const c = new Captions();
    const n = new Narrator(c);
    n.say('The heap is where objects live.', 'Heap');
    n.say('The garbage collector reclaims memory.', 'GC');
    expect(c.lines).toEqual([
      { topic: 'Heap', interrupted: false },
      { topic: 'GC', interrupted: true },
    ]);
  });

  it('makes background commentary wait for the current explanation', () => {
    const c = new Captions();
    const n = new Narrator(c);
    n.say('The heap is where objects live.', 'Heap');
    n.say('A method was compiled.', 'JIT', 'background');
    expect(c.current).toBe('Heap');
    expect(c.waiting).toBe(1);
    vi.advanceTimersByTime(2_600); // one short line reads in 2.5 s
    expect(c.current).toBe('JIT');
    vi.advanceTimersByTime(2_600);
    expect(c.current).toBeNull();
  });

  it('drops stale background lines instead of piling them up', () => {
    const c = new Captions();
    const n = new Narrator(c);
    n.say('Explaining.', 'Now');
    for (const t of ['a', 'b', 'c', 'd']) n.say('Background.', t, 'background');
    expect(c.waiting).toBe(2);
    vi.advanceTimersByTime(3_000);
    expect(c.current).toBe('c');
  });

  it('skip goes to the next line, stop clears everything', () => {
    const c = new Captions();
    const n = new Narrator(c);
    n.say('One.', 'one');
    n.say('Two.', 'two', 'background');
    n.skip();
    expect(c.current).toBe('two');
    n.say('Three.', 'three', 'background');
    n.stop();
    expect(c.current).toBeNull();
    expect(c.waiting).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(c.current).toBeNull();
  });

  it('stays silent when switched off', () => {
    const c = new Captions();
    const n = new Narrator(c, false);
    n.say('Hello.', 'hi');
    expect(c.lines).toEqual([]);
  });
});
