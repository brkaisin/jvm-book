import { describe, expect, it } from 'vitest';
import { rankVoices, voiceLabel, voiceScore } from '../src/audio/voices';

const v = (name: string, lang = 'en-US') => ({ name, lang });

describe('rankVoices', () => {
  it('puts neural and enhanced voices before classic ones, and robotic ones last', () => {
    const voices = [
      v('eSpeak English', 'en'),
      v('Microsoft David - English (United States)'),
      v('Samantha'),
      v('Zarvox'),
      v('Microsoft Aria Online (Natural) - English (United States)'),
      v('Google UK English Female', 'en-GB'),
      v('Ava (Premium)'),
    ];
    expect(rankVoices(voices).map((x) => x.name)).toEqual([
      'Microsoft Aria Online (Natural) - English (United States)',
      'Ava (Premium)',
      'Google UK English Female',
      'Samantha',
      'Microsoft David - English (United States)',
      'eSpeak English',
      'Zarvox',
    ]);
  });

  it('only keeps English voices, in the browser order when equally good', () => {
    const voices = [v('Thomas', 'fr-FR'), v('Voice A', 'en-AU'), v('Voice B', 'en-AU'), v('Anna', 'de_DE')];
    expect(rankVoices(voices).map((x) => x.name)).toEqual(['Voice A', 'Voice B']);
    expect(voiceScore(v('Thomas', 'fr-FR'))).toBe(-Infinity);
  });

  it('accepts underscores in language tags (Android)', () => {
    expect(rankVoices([v('English United States', 'en_US')])).toHaveLength(1);
  });
});

describe('voiceLabel', () => {
  it('keeps what tells voices apart', () => {
    expect(voiceLabel(v('Microsoft Aria Online (Natural) - English (United States)'))).toBe('Aria (Natural) · en-US');
    expect(voiceLabel(v('Google UK English Male', 'en-GB'))).toBe('UK English Male · en-GB');
    expect(voiceLabel(v('Daniel', 'en_GB'))).toBe('Daniel · en-GB');
  });
});
