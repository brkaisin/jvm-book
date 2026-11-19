import { describe, expect, it } from 'vitest';
import { allLines } from '../src/narration';
import { speakable } from '../src/audio/speech';
import { clipKey, clipUrl, VOICES } from '../src/audio/voices';

describe('recorded narration', () => {
  it('has a recording of every line the narrator can say, in every voice', () => {
    const missing = allLines()
      .map(speakable)
      .filter((t) => VOICES.some((v) => !clipUrl(v, t)));
    // Run `npm run narrate` after adding or editing a line.
    expect(missing).toEqual([]);
  });

  it('names each line by a stable key', () => {
    expect(clipKey('Hi! This is how I sound.')).toBe(clipKey('Hi! This is how I sound.'));
    expect(clipKey('a')).not.toBe(clipKey('b'));
    expect(clipKey('a')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('gives every line its own key', () => {
    const texts = [...new Set(allLines().map(speakable))];
    expect(new Set(texts.map(clipKey)).size).toBe(texts.length);
  });
});
