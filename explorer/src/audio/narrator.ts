// The narrator: reads explanations aloud with the browser's own speech
// synthesis, and drives the captions. Without a voice (or when muted), the
// captions still show, timed to a normal reading pace.
//
// Two priorities keep it polite: what the visitor asked for (a click, a tour
// step) takes over at once, while background commentary (a "what just
// happened" card, a note about the JIT) waits for the current explanation to
// finish instead of cutting it off.

import { readingSeconds, speakable } from './speech';

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
}

/** Voices that sound natural, best first; any English voice is the fallback. */
const PREFERRED = [/Google UK English Male/i, /Daniel/i, /Microsoft (Ryan|Guy|Christopher)/i, /Alex/i, /Google US English/i, /Samantha/i];
/** Background lines wait at most this many; older ones are dropped (they would be stale). */
const MAX_QUEUE = 2;

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
  ) {
    this.on = enabled;
    if (!this.synth) return;
    const pick = () => {
      const voices = this.synth!.getVoices().filter((v) => v.lang.startsWith('en'));
      this.voice = PREFERRED.map((re) => voices.find((v) => re.test(v.name))).find(Boolean) ?? voices[0] ?? null;
    };
    pick();
    this.synth.addEventListener('voiceschanged', pick);
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
    const u = new SpeechSynthesisUtterance(line.text);
    u.voice = this.voice;
    u.lang = this.voice.lang;
    u.rate = 1.03;
    u.pitch = 0.95;
    u.onstart = () => gen === this.generation && this.listener.start(line, true, interrupted);
    u.onboundary = (e) => gen === this.generation && this.listener.word(e.charIndex);
    u.onend = done;
    u.onerror = done;
    this.synth.speak(u);
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
