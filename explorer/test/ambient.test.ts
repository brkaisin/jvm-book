import { describe, expect, it } from 'vitest';
import { PROGRESSION, SPARKLE, midiToHz } from '../src/audio/ambient';

describe('ambient music', () => {
  it('converts MIDI notes to frequencies', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(60)).toBeCloseTo(261.63, 1);
  });

  it('keeps the pad low and gentle: no voice above ~600 Hz, no voice leaps', () => {
    for (const chord of PROGRESSION) for (const n of chord) expect(midiToHz(n)).toBeLessThan(600);
    // Consecutive chords move each voice by at most a fourth: smooth glides.
    PROGRESSION.forEach((chord, i) => {
      const next = PROGRESSION[(i + 1) % PROGRESSION.length];
      chord.forEach((n, v) => expect(Math.abs(next[v] - n)).toBeLessThanOrEqual(5));
    });
  });

  it('only sparkles on notes of the C major pentatonic', () => {
    for (const n of SPARKLE) expect([0, 2, 4, 7, 9]).toContain(n % 12);
  });
});
