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

/** A speech engine that says each utterance instantly when told to `finish()` it. */
class FakeSynth extends EventTarget {
  spoken: FakeUtterance[] = [];
  current: FakeUtterance | null = null;
  constructor(private readonly list: { name: string; lang: string }[]) {
    super();
  }
  getVoices() {
    return this.list;
  }
  speak(u: FakeUtterance) {
    this.spoken.push(u);
    this.current = u;
    u.onstart?.();
  }
  cancel() {
    this.current = null;
  }
  finish() {
    const u = this.current;
    this.current = null;
    u?.onend?.();
  }
}

class FakeUtterance {
  voice: unknown = null;
  lang = '';
  rate = 1;
  pitch = 1;
  onstart?: () => void;
  onend?: () => void;
  onboundary?: (e: { charIndex: number }) => void;
  onerror?: () => void;
  constructor(readonly text: string) {}
}

describe('Narrator with a voice', () => {
  let synth: FakeSynth;
  beforeEach(() => {
    vi.useFakeTimers();
    synth = new FakeSynth([
      { name: 'eSpeak English', lang: 'en' },
      { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US' },
      { name: 'Daniel', lang: 'en-GB' },
    ]);
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('picks the most natural voice, unless the visitor chose another', () => {
    const a = new Narrator(new Captions());
    a.say('Hello.', 'hi');
    expect((synth.spoken[0].voice as { name: string }).name).toMatch(/Aria/);
    const b = new Narrator(new Captions(), true, 'Daniel');
    b.say('Hello.', 'hi');
    expect((synth.spoken[1].voice as { name: string }).name).toBe('Daniel');
  });

  it('says one sentence at a time, with a breath in between', () => {
    const words: number[] = [];
    const c = new Captions();
    c.word = (i: number) => void words.push(i);
    const n = new Narrator(c);
    n.say('The heap is shared. Objects live there!', 'Heap');
    expect(synth.spoken.map((u) => u.text)).toEqual(['The heap is shared.']);
    synth.finish();
    expect(synth.spoken).toHaveLength(1); // breathing
    vi.advanceTimersByTime(400);
    expect(synth.spoken.map((u) => u.text)).toEqual(['The heap is shared.', 'Objects live there!']);
    expect(synth.spoken[0].rate).not.toBe(synth.spoken[1].rate);
    expect(words).toEqual([0, 20]); // captions jump to each sentence even without word boundaries
    expect(c.current).toBe('Heap');
    synth.finish();
    vi.advanceTimersByTime(0);
    expect(c.current).toBeNull();
  });

  it('forgets the rest of a line when interrupted', () => {
    const n = new Narrator(new Captions());
    n.say('One. Two. Three.', 'count');
    n.say('Something else.', 'other');
    synth.finish();
    vi.advanceTimersByTime(2_000);
    expect(synth.spoken.map((u) => u.text)).toEqual(['One.', 'Something else.']);
  });
});
