// Turns the explorer's HTML texts into something a speech engine reads well,
// the way a person would say it rather than the way it is typeset.

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/** Words that text-to-speech engines mispronounce, and how to say them. */
const PRONOUNCE: [RegExp, string][] = [
  [/0xCAFEBABE/gi, 'cafe babe'],
  [/\bC1\b/g, 'C one'],
  [/\bC2\b/g, 'C two'],
  [/\bG1\b/g, 'G one'],
  [/\bZGC\b/g, 'Z G C'],
  [/\bJIT\b/g, 'jit'],
  [/\bjavac\b/g, 'java C'],
  [/\bscalac\b/g, 'scala C'],
  [/\bkotlinc\b/g, 'kotlin C'],
  [/\bJNI\b/g, 'J N I'],
  [/\bFFM\b/g, 'F F M'],
  [/\bJFR\b/g, 'J F R'],
  [/\bTLAB\b/g, 'T lab'],
  [/\bnmethod\b/g, 'N method'],
  [/-Xmx/g, 'X M X'],
  [/-Xms/g, 'X M S'],
  [/-Xss/g, 'X S S'],
  [/\be\.g\.,?/g, 'for example,'],
  [/\bi\.e\.,?/g, 'that is,'],
  [/\bvs\.?(?=\s)/g, 'versus'],
  [/→/g, ' to '],
  [/×/g, ' times '],
  [/…/g, '...'],
  // Code: `java.lang.Object` is "java dot lang dot Object", `run()` is "run".
  [/\b([a-z]\w*)\.(?=[a-zA-Z])/g, '$1 dot '],
  [/\b(\w+)\(\)/g, '$1'],
];

/**
 * How a speaker breathes through punctuation meant for the eye: asides in
 * parentheses or between dashes become short pauses, middle dots become
 * commas, and slashes between words disappear ("fork/join", "I/O").
 */
const PHRASING: [RegExp, string][] = [
  [/\s*\(([^()]*)\)\s*(?=[.,;:!?])/g, ', $1'],
  [/\s*\(([^()]*)\)\s*/g, ', $1, '],
  [/\s+[—–]\s+/g, ', '],
  [/\s*·\s*/g, ', '],
  [/\bI\/O\b/g, 'I O'],
  [/(\w)\/(\w)/g, '$1 $2'],
  [/,\s*,/g, ','],
  [/,\s*([.!?:;])/g, '$1'],
];

/** Plain, pronounceable text from an HTML snippet. */
export function speakable(html: string): string {
  let s = html.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? ' ');
  for (const [re, say] of PRONOUNCE) s = s.replace(re, say);
  for (const [re, say] of PHRASING) s = s.replace(re, say);
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?:;])/g, '$1')
    .replace(/^[,\s]+/, '')
    .trim();
}

export interface Phrase {
  text: string;
  /** Where the phrase starts in the whole line, to keep captions in sync. */
  offset: number;
}

/**
 * Splits a line into sentences, each spoken on its own. A person pauses
 * between sentences and starts the next one fresh; an engine reading one long
 * string runs them together in a single flat breath (and Chrome silently gives
 * up on utterances longer than about fifteen seconds).
 */
export function phrases(text: string): Phrase[] {
  const out: Phrase[] = [];
  let start = 0;
  const push = (end: number) => {
    const t = text.slice(start, end).trim();
    if (t) out.push({ text: t, offset: start + text.slice(start).search(/\S/) });
  };
  for (const m of text.matchAll(/[.!?]+\s+(?=\S)/g)) {
    push(m.index + m[0].length);
    start = m.index + m[0].length;
  }
  push(text.length);
  return out;
}

/** Roughly how long reading `text` aloud takes, for captions without a voice. */
export function readingSeconds(text: string): number {
  return Math.max(2.5, text.split(/\s+/).length * 0.36);
}
