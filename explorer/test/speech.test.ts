import { describe, expect, it } from 'vitest';
import { HOTSPOTS } from '../src/content';
import { MOMENTS } from '../src/story';
import { readingSeconds, speakable } from '../src/audio/speech';

describe('speakable', () => {
  it('strips markup and decodes entities', () => {
    expect(speakable('The <b>heap</b> &amp; <code>jcmd &lt;pid&gt;</code>')).toBe('The heap & jcmd <pid>');
  });

  it('spells out what speech engines get wrong', () => {
    expect(speakable('C1 then C2, on G1 or ZGC, starts with 0xCAFEBABE')).toBe('C one then C two, on G one or Z G C, starts with cafe babe');
    expect(speakable('the JIT → javac')).toBe('the jit to java C');
  });

  it('leaves no markup in any hotspot or moment text', () => {
    const texts = [...Object.values(HOTSPOTS).flatMap((h) => [h.see, h.summary]), ...Object.values(MOMENTS).map((m) => m.text)];
    for (const t of texts) expect(speakable(t)).not.toMatch(/[<>]|&[a-z]+;/);
  });

  it('estimates reading time from the number of words', () => {
    expect(readingSeconds('one two')).toBe(2.5);
    expect(readingSeconds(new Array(100).fill('word').join(' '))).toBeCloseTo(36);
  });
});
