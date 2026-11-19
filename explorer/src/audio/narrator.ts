// The narrator: reads explanations aloud and drives the captions. Every line
// was recorded ahead of time with a natural voice (see voices.ts); a line
// without a recording, or a visitor who muted the narrator, still gets the
// captions, timed to a normal reading pace.
//
// Two priorities keep it polite: what the visitor asked for (a click, a tour
// step) takes over at once, while background commentary (a "what just
// happened" card, a note about the JIT) waits for the current explanation to
// finish instead of cutting it off.

import { readingSeconds, speakable } from './speech';
import { clipUrl, voiceById, VOICES, type Voice } from './voices';

export type Priority = 'user' | 'background';

export interface Line {
  text: string;
  /** What it is about, shown above the subtitles (e.g. "The heap"). */
  topic: string;
}

export interface NarratorListener {
  /** A new line starts. `voiced` is false when only captions are shown; `interrupted` when it cut another line short. */
  start(line: Line, voiced: boolean, interrupted: boolean): void;
  /** The voice reached about character `index` of the current line. */
  word(index: number): void;
  /** Nothing more to say. */
  end(): void;
  /** How many lines are waiting. */
  queued(n: number): void;
  /** Another voice was picked. */
  voices?(voices: readonly Voice[], current: Voice): void;
}

/** Background lines wait at most this many; older ones are dropped (they would be stale). */
const MAX_QUEUE = 2;
/** How often the captions follow the voice, in milliseconds. */
const CAPTION_TICK = 120;

export class Narrator {
  private voice: Voice;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private audio: HTMLAudioElement | null = null;
  private on: boolean;
  private speaking = false;
  private queue: Line[] = [];
  /** Bumped at every new line, so callbacks of a cancelled line are ignored. */
  private generation = 0;

  constructor(
    private readonly listener: NarratorListener,
    enabled = true,
    /** Id of the voice the visitor picked last time, if any. */
    preferred: string | null = null,
  ) {
    this.on = enabled;
    this.voice = voiceById(preferred);
    this.listener.voices?.(VOICES, this.voice);
  }

  get current(): Voice {
    return this.voice;
  }

  /** Speaks with another voice from now on. */
  setVoice(id: string): void {
    this.voice = voiceById(id);
    this.listener.voices?.(VOICES, this.voice);
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
      this.cancel();
      this.next();
    };
    const captionsOnly = () => {
      if (gen !== this.generation) return;
      this.listener.start(line, false, interrupted);
      this.timer = setTimeout(done, readingSeconds(line.text) * 1000);
    };
    this.speaking = true;
    const url = typeof Audio === 'undefined' ? null : clipUrl(this.voice, line.text);
    if (!url) return captionsOnly();

    const audio = new Audio(url);
    this.audio = audio;
    let started = false;
    audio.addEventListener('playing', () => {
      if (gen !== this.generation || started) return;
      started = true;
      this.listener.start(line, true, interrupted);
      this.ticker = setInterval(() => {
        if (audio.duration > 0) this.listener.word(Math.floor((audio.currentTime / audio.duration) * line.text.length));
      }, CAPTION_TICK);
    });
    audio.addEventListener('ended', done);
    // A missing file, or a browser that refuses to play: fall back to captions.
    const failed = () => {
      if (gen !== this.generation) return;
      if (started) return done();
      this.stopAudio();
      captionsOnly();
    };
    audio.addEventListener('error', failed);
    audio.play().catch(failed);
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

  private stopAudio(): void {
    clearInterval(this.ticker);
    if (!this.audio) return;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio = null;
  }

  private cancel(): void {
    this.generation++;
    this.speaking = false;
    clearTimeout(this.timer);
    this.stopAudio();
  }
}
