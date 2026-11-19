import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Narrator, type Line, type NarratorListener } from '../src/audio/narrator';
import { clipUrl, voiceById, VOICES } from '../src/audio/voices';

/** Records what the captions would show. (No speech engine in Node: captions only, timed.) */
class Captions implements NarratorListener {
  lines: { topic: string; interrupted: boolean }[] = [];
  current: string | null = null;
  waiting = 0;
  start(line: Line, _voiced: boolean, interrupted: boolean) {
    this.lines.push({ topic: line.topic, interrupted });
    this.current = line.topic;
  }
  word(_index: number) {}
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

/** Just enough of an audio element: plays when told to, ends when the test says so. */
class FakeAudio extends EventTarget {
  static all: FakeAudio[] = [];
  static refuse = false;
  currentTime = 0;
  duration = 4;
  paused = true;
  constructor(readonly src: string) {
    super();
    FakeAudio.all.push(this);
  }
  play() {
    if (FakeAudio.refuse) return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {}
  finish() {
    this.dispatchEvent(new Event('ended'));
  }
}

const RECORDED = 'Hi! This is how I sound.';

describe('Narrator with recorded voices', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudio.all = [];
    FakeAudio.refuse = false;
    vi.stubGlobal('Audio', FakeAudio);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('plays the recording in the chosen voice, and follows it with the captions', () => {
    const words: number[] = [];
    const c = new Captions();
    c.word = (i: number) => void words.push(i);
    const n = new Narrator(c, true, 'aoede');
    n.say(RECORDED, 'Voice');
    expect(FakeAudio.all).toHaveLength(1);
    expect(FakeAudio.all[0].src).toBe(clipUrl(voiceById('aoede'), RECORDED));
    FakeAudio.all[0].currentTime = 2;
    vi.advanceTimersByTime(200);
    expect(words.at(-1)).toBe(Math.floor(RECORDED.length / 2));
    FakeAudio.all[0].finish();
    expect(c.current).toBeNull();
  });

  it('falls back to the default voice for an unknown preference', () => {
    expect(new Narrator(new Captions(), true, 'Microsoft David').current).toBe(VOICES[0]);
  });

  it('shows captions alone for a line that was never recorded', () => {
    const c = new Captions();
    new Narrator(c).say('A line nobody recorded.', 'x');
    expect(FakeAudio.all).toHaveLength(0);
    expect(c.current).toBe('x');
  });

  it('shows captions alone when the browser refuses to play', async () => {
    FakeAudio.refuse = true;
    const c = new Captions();
    new Narrator(c).say(RECORDED, 'Voice');
    await vi.advanceTimersByTimeAsync(0);
    expect(c.current).toBe('Voice');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(c.current).toBeNull();
  });

  it('silences the current recording when interrupted', () => {
    const n = new Narrator(new Captions());
    n.say(RECORDED, 'one');
    n.say(RECORDED, 'two');
    expect(FakeAudio.all.map((a) => a.paused)).toEqual([true, false]);
  });
});
