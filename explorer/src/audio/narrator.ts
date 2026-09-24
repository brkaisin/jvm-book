// The narrator: reads explanations aloud with the browser's own speech
// synthesis, and drives the captions. Without a voice (or when muted), the
// captions still show, timed to a normal reading pace.
//
// Two priorities keep it polite: what the visitor asked for (a click, a tour
// step) takes over at once, while background commentary (a "what just
// happened" card, a note about the JIT) waits for the current explanation to
// finish instead of cutting it off.
//
// To sound like a person rather than a machine reading a page, it picks the
// most natural voice the browser has, and says one sentence at a time with a
// short breath in between, each with a slightly different pace and pitch.

import { phrases, readingSeconds, speakable, type Phrase } from './speech';
import { rankVoices } from './voices';

export type Priority = 'user' | 'background';

export interface Line {
  text: string;
  /** What it is about, shown above the subtitles (e.g. "The heap"). */
  topic: string;
}

export interface NarratorListener {
  /** A new line starts. `voiced` is false when only captions are shown; `interrupted` when it cut another line short. */
  start(line: Line, voiced: boolean, interrupted: boolean): void;
  /** The voice reached character `index` of the current line. */
  word(index: number): void;
  /** Nothing more to say. */
  end(): void;
  /** How many lines are waiting. */
  queued(n: number): void;
  /** The voices on offer changed (they load asynchronously), or another was picked. */
  voices?(voices: SpeechSynthesisVoice[], current: SpeechSynthesisVoice | null): void;
}
/** Background lines wait at most this many; older ones are dropped (they would be stale). */
const MAX_QUEUE = 2;
/** A calm, conversational pace: engines' default rate reads like a hurried announcement. */
const RATE = 0.96;
/** Small per-sentence changes of pace and pitch, so it never settles into a drone. */
const LILT: [rate: number, pitch: number][] = [
  [1, 1],
  [1.03, 0.97],
  [0.98, 1.02],
  [1.02, 0.99],
  [0.97, 1.01],
];

/** How long a speaker pauses after a sentence ending like this one. */
export function breathAfter(sentence: string): number {
  if (/[?!]$/.test(sentence)) return 380;
  if (/:$/.test(sentence)) return 220;
  if (/\.\.\.$/.test(sentence)) return 520;
  return 320;
}

export class Narrator {
  private voice: SpeechSynthesisVoice | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private on: boolean;
  private speaking = false;
  private queue: Line[] = [];
  /** Bumped at every new line, so callbacks of a cancelled line are ignored. */
  private generation = 0;
  private readonly synth: SpeechSynthesis | null = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;

  constructor(
    private readonly listener: NarratorListener,
    enabled = true,
    /** Name of the voice the visitor picked last time, if any. */
    private preferred: string | null = null,
  ) {
    this.on = enabled;
    if (!this.synth) return;
    const pick = () => {
      const voices = this.voices;
      this.voice = voices.find((v) => v.name === this.preferred) ?? voices[0] ?? null;
      this.listener.voices?.(voices, this.voice);
    };
    pick();
    this.synth.addEventListener('voiceschanged', pick);
  }

  /** The English voices available, most natural first. */
  get voices(): SpeechSynthesisVoice[] {
    return this.synth ? rankVoices(this.synth.getVoices()) : [];
  }

  /** Speaks with another voice from now on. */
  setVoice(name: string): void {
    const v = this.voices.find((x) => x.name === name);
    if (!v) return;
    this.preferred = name;
    this.voice = v;
    this.listener.voices?.(this.voices, v);
  }

  get enabled(): boolean {
    return this.on;
  }

  get busy(): boolean {
    return this.speaking;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    if (!on) this.stop();
  }

  /** Says `html` about `topic`: at once for the visitor's requests, after the current line otherwise. */
  say(html: string, topic: string, priority: Priority = 'user'): void {
    if (!this.on) return;
    const text = speakable(html);
    if (!text) return;
    const line = { text, topic };
    if (priority === 'user') {
      const interrupted = this.speaking;
      this.queue = [];
      this.speak(line, interrupted);
    } else if (this.speaking) {
      this.queue.push(line);
      if (this.queue.length > MAX_QUEUE) this.queue.shift();
    } else this.speak(line, false);
    this.listener.queued(this.queue.length);
  }

  /** Stops the current line and goes on with the next one, if any. */
  skip(): void {
    this.cancel();
    this.next();
  }

  /** Stops talking and forgets what was waiting. */
  stop(): void {
    this.queue = [];
    this.cancel();
    this.listener.queued(0);
    this.listener.end();
  }

  private speak(line: Line, interrupted: boolean): void {
    this.cancel();
    const gen = ++this.generation;
    const done = () => {
      if (gen !== this.generation) return; // a newer line took over
      this.speaking = false;
      this.next();
    };
    this.speaking = true;
    if (!this.synth || !this.voice) {
      this.listener.start(line, false, interrupted);
      this.timer = setTimeout(done, readingSeconds(line.text) * 1000);
      return;
    }
    this.sentence(line, phrases(line.text), 0, gen, interrupted, done);
  }

  /** Says the `i`-th sentence of `line`, then breathes and goes on with the next. */
  private sentence(line: Line, parts: Phrase[], i: number, gen: number, interrupted: boolean, done: () => void): void {
    const part = parts[i];
    if (!part || !this.voice) return done();
    const [rate, pitch] = LILT[i % LILT.length];
    const u = new SpeechSynthesisUtterance(part.text);
    u.voice = this.voice;
    u.lang = this.voice.lang;
    u.rate = RATE * rate;
    u.pitch = pitch;
    u.onstart = () => {
      if (gen !== this.generation) return;
      if (i === 0) this.listener.start(line, true, interrupted);
      this.listener.word(part.offset);
    };
    // Some voices (Google's) never report word boundaries: the captions then move sentence by sentence.
    u.onboundary = (e) => gen === this.generation && this.listener.word(part.offset + e.charIndex);
    u.onend = () => {
      if (gen !== this.generation) return;
      const last = i === parts.length - 1;
      this.timer = setTimeout(() => this.sentence(line, parts, i + 1, gen, interrupted, done), last ? 0 : breathAfter(part.text));
    };
    u.onerror = done;
    this.synth!.speak(u);
  }

  private next(): void {
    const line = this.queue.shift();
    this.listener.queued(this.queue.length);
    if (line) this.speak(line, false);
    else {
      this.speaking = false;
      this.listener.end();
    }
  }

  private cancel(): void {
    this.generation++;
    this.speaking = false;
    clearTimeout(this.timer);
    this.synth?.cancel();
  }
}
