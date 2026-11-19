// The narrator's voices. Browsers' built-in speech synthesis sounds robotic on
// most machines, so every line is recorded ahead of time with neural voices
// (through Speko, by scripts/narrate.mjs) and shipped as small audio clips.

import clips from './clips.json';

export interface Voice {
  /** Folder of its clips, and the name saved in the visitor's preferences. */
  id: string;
  label: string;
  /** How scripts/narrate.mjs asks Speko for it. */
  speko: { provider: string; voice: string };
}

export const VOICES: readonly Voice[] = [
  { id: 'charon', label: 'Charon · calm, deep', speko: { provider: 'google-tts:gemini-3.8-flash-lite-tts', voice: 'Charon' } },
  { id: 'draco', label: 'Draco · British', speko: { provider: 'deepgram:aura-2', voice: 'aura-2-draco-en' } },
  { id: 'aoede', label: 'Aoede · warm, female', speko: { provider: 'google-tts:gemini-3.8-flash-lite-tts', voice: 'Aoede' } },
];

export const DEFAULT_VOICE = VOICES[0];

export function voiceById(id: string | null): Voice {
  return VOICES.find((v) => v.id === id) ?? DEFAULT_VOICE;
}

/** A short, stable name for a spoken text (FNV-1a), used as its clip's file name. */
export function clipKey(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const recorded = new Set<string>(clips.keys);

/** Where the recording of `text` is, or null when it was never recorded. */
export function clipUrl(voice: Voice, text: string): string | null {
  const key = clipKey(text);
  return recorded.has(key) ? `${import.meta.env.BASE_URL}narration/${voice.id}/${key}.${clips.format}` : null;
}
