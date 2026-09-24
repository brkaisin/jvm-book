import { describe, expect, it } from 'vitest';
import { HOTSPOTS } from '../src/content';
import { MOMENTS } from '../src/story';
import { phrases, readingSeconds, speakable } from '../src/audio/speech';

describe('speakable', () => {
  it('strips markup and decodes entities', () => {
    expect(speakable('The <b>heap</b> &amp; <code>jcmd &lt;pid&gt;</code>')).toBe('The heap & jcmd <pid>');
  });

  it('spells out what speech engines get wrong', () => {
    expect(speakable('C1 then C2, on G1 or ZGC, starts with 0xCAFEBABE')).toBe('C one then C two, on G one or Z G C, starts with cafe babe');
    expect(speakable('the JIT → javac')).toBe('the jit to java C');
  });

  it('reads punctuation meant for the eye the way a person would say it', () => {
    expect(speakable('Eden filled up (the towers froze), so G1 stopped.')).toBe('Eden filled up, the towers froze, so G1 stopped.'.replace('G1', 'G one'));
    expect(speakable('Big objects (a <b>TLAB</b>).')).toBe('Big objects, a T lab.');
    expect(speakable('The heap — shared by all threads — holds objects.')).toBe('The heap, shared by all threads, holds objects.');
    expect(speakable('<code>java.lang.Object</code> and <code>run()</code>, e.g. for I/O')).toBe('java dot lang dot Object and run, for example, for I O');
    expect(speakable('Tour · The heap')).toBe('Tour, The heap');
  });

  it('leaves no markup in any hotspot or moment text', () => {
    const texts = [...Object.values(HOTSPOTS).flatMap((h) => [h.see, h.summary]), ...Object.values(MOMENTS).map((m) => m.text)];
    for (const t of texts) expect(speakable(t)).not.toMatch(/[<>]|&[a-z]+;/);
  });

  it('never leaves stray commas from rewritten parentheses', () => {
    const texts = [...Object.values(HOTSPOTS).flatMap((h) => [h.see, h.summary]), ...Object.values(MOMENTS).map((m) => m.text)];
    for (const t of texts) expect(speakable(t)).not.toMatch(/,\s*[,.!?:;]|\(|\)|^,/);
  });

  it('estimates reading time from the number of words', () => {
    expect(readingSeconds('one two')).toBe(2.5);
    expect(readingSeconds(new Array(100).fill('word').join(' '))).toBeCloseTo(36);
  });
});

describe('phrases', () => {
  it('splits a line into sentences, remembering where each starts', () => {
    const t = 'The heap. It holds objects! Really? Yes: all of them.';
    const p = phrases(t);
    expect(p.map((x) => x.text)).toEqual(['The heap.', 'It holds objects!', 'Really?', 'Yes: all of them.']);
    for (const x of p) expect(t.slice(x.offset, x.offset + x.text.length)).toBe(x.text);
  });

  it('keeps decimals and dotted names in one sentence', () => {
    expect(phrases('Version 1.2 of java dot base is out.').length).toBe(1);
    expect(phrases('Clojure... The JVM never sees it.').map((x) => x.text)).toEqual(['Clojure...', 'The JVM never sees it.']);
  });
});
