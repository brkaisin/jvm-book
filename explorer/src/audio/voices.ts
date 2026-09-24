// Which of the browser's voices to speak with. Browsers ship a mix: neural
// voices that sound like a person (Edge's "Natural" ones, Apple's "Premium"
// and "Enhanced" downloads, Google's), decent classic ones, and old
// formant synthesisers and novelty voices that sound like a 1990s robot. We
// rank them so the visitor hears the most human one they have.

/** The part of a SpeechSynthesisVoice the ranking looks at. */
export interface VoiceInfo {
  name: string;
  lang: string;
}

const SCORES: [RegExp, number][] = [
  // Neural voices: by far the most natural.
  [/\b(natural|neural)\b/i, 100],
  [/\(premium\)/i, 90],
  [/\(enhanced\)/i, 70],
  [/\bonline\b/i, 40],
  // Good classic voices.
  [/^Google (UK|US) English/i, 45],
  [/\b(Samantha|Daniel|Karen|Moira|Tessa|Serena|Ava|Allison|Susan|Tom|Evan|Nathan|Zoe|Jamie|Kate|Oliver|Arthur|Martha)\b/, 30],
  [/\bMicrosoft (Aria|Jenny|Guy|Ryan|Sonia|Libby|Natasha|William|Andrew|Emma|Brian|Ava|Christopher|Michelle)\b/, 30],
  // Robotic: old SAPI desktop voices, eSpeak, Apple's Eloquence and novelty voices.
  [/\bMicrosoft (David|Zira|Mark|Hazel|George)\b/, -20],
  [/espeak|mbrola|festival|pico/i, -80],
  [/\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Ralph|Kathy|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley)\b/, -100],
];

/** How natural a voice probably sounds; higher is better. Only English voices count. */
export function voiceScore(v: VoiceInfo): number {
  if (!/^en\b/i.test(v.lang.replace('_', '-'))) return -Infinity;
  let score = /^en-(GB|US)$/i.test(v.lang.replace('_', '-')) ? 5 : 0;
  for (const [re, s] of SCORES) if (re.test(v.name)) score += s;
  return score;
}

/** English voices, most natural first (ties keep the browser's order). */
export function rankVoices<V extends VoiceInfo>(voices: readonly V[]): V[] {
  return voices
    .map((v, i) => ({ v, i, s: voiceScore(v) }))
    .filter((x) => x.s > -Infinity)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.v);
}

/** A short, readable name for a voice picker: "Microsoft Aria Online (Natural) - English (United States)" is "Aria (Natural)". */
export function voiceLabel(v: VoiceInfo): string {
  const name = v.name
    .replace(/\s+-\s+.*$/, '')
    .replace(/^(Microsoft|Google|Apple)\s+/, '')
    .replace(/\s+Online\b/, '')
    .trim();
  return `${name} · ${v.lang.replace('_', '-')}`;
}
