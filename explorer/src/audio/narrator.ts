// The narrator: reads explanations aloud with the browser's own speech
// synthesis, and drives the captions. Without a voice (or when muted), the
// captions still show, timed to a normal reading pace.

import { readingSeconds, speakable } from './speech';

export interface NarratorListener {
  /** A new line starts; `voiced` is false when only captions are shown. */
  start(text: string, voiced: boolean): void;
  /** The voice reached character `index` of the current line. */
  word(index: number): void;
  end(): void;
}

/** Voices that sound natural, best first; any English voice is the fallback. */
const PREFERRED = [/Google UK English Male/i, /Daniel/i, /Microsoft (Ryan|Guy|Christopher)/i, /Alex/i, /Google US English/i, /Samantha/i];

export class Narrator {
  private voice: SpeechSynthesisVoice | null = null;
  private timer: number | undefined;
  private on: boolean;
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

  setEnabled(on: boolean): void {
    this.on = on;
    if (!on) this.stop();
  }

  /** Says `html` (replacing whatever was being said). */
  say(html: string): void {
    if (!this.on) return;
    this.stop();
    const text = speakable(html);
    if (!text) return;
    if (!this.synth || !this.voice) {
      this.listener.start(text, false);
      this.timer = window.setTimeout(() => this.listener.end(), readingSeconds(text) * 1000);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.voice = this.voice;
    u.lang = this.voice.lang;
    u.rate = 1.03;
    u.pitch = 0.95;
    u.onstart = () => this.listener.start(text, true);
    u.onboundary = (e) => this.listener.word(e.charIndex);
    u.onend = () => this.listener.end();
    u.onerror = () => this.listener.end();
    this.synth.speak(u);
  }

  stop(): void {
    window.clearTimeout(this.timer);
    this.synth?.cancel();
    this.listener.end();
  }
}
