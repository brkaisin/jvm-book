// Turns the explorer's HTML texts into something a speech engine reads well.

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
  [/→/g, ' to '],
  [/…/g, '...'],
  [/\be\.g\./g, 'for example'],
];

/** Plain, pronounceable text from an HTML snippet. */
export function speakable(html: string): string {
  let s = html.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? ' ');
  for (const [re, say] of PRONOUNCE) s = s.replace(re, say);
  return s.replace(/\s+/g, ' ').trim();
}

/** Roughly how long reading `text` aloud takes, for captions without a voice. */
export function readingSeconds(text: string): number {
  return Math.max(2.5, text.split(/\s+/).length * 0.36);
}
