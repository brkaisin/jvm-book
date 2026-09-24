// The background music: a soft, slowly evolving pad. Four sine voices glide
// through a gentle chord progression, with a little echo for space and now
// and then a quiet high note. During a stop-the-world pause it goes muffled
// and softer, as if the world held its breath.

/** Frequency of a MIDI note (69 = A4 = 440 Hz). */
export const midiToHz = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

/**
 * Cmaj9 → Am9 → Fmaj9 → G6/9, voiced low and open: warm, never tense.
 * Each chord is four MIDI notes, one per voice, so voices glide smoothly.
 */
export const PROGRESSION: readonly (readonly [number, number, number, number])[] = [
  [48, 55, 64, 74], // C3 G3 E4 D5
  [45, 52, 60, 71], // A2 E3 C4 B4
  [41, 48, 57, 67], // F2 C3 A3 G4
  [43, 50, 59, 69], // G2 D3 B3 A4
];

/** Notes for the occasional sparkle: C major pentatonic, high and soft. */
export const SPARKLE = [72, 74, 76, 79, 81, 84, 86, 88];

const CHORD_SECONDS = 9;
const VOICE_GAIN = 0.022;

export class Ambient {
  private readonly voices: OscillatorNode[] = [];
  private readonly filter: BiquadFilterNode;
  private readonly out: GainNode;
  private chord = 0;
  private timers: number[] = [];

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1400;
    this.filter.Q.value = 0.3;

    // A simple echo: soft, spacious, a little dark.
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.48;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1800;
    this.filter.connect(delay).connect(damp).connect(feedback).connect(delay);
    damp.connect(wet).connect(this.out);
    this.filter.connect(this.out);
    this.out.connect(destination);

    PROGRESSION[0].forEach((note, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = midiToHz(note);
      // A slightly detuned voice breathes more than a perfect one.
      o.detune.value = (i - 1.5) * 3;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? VOICE_GAIN * 1.2 : VOICE_GAIN * (i === 3 ? 0.55 : 0.8);
      // Each voice swells slowly on its own, so the pad never sounds static.
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 0.05 + i * 0.023;
      depth.gain.value = g.gain.value * 0.45;
      lfo.connect(depth).connect(g.gain);
      lfo.start();
      o.connect(g).connect(this.filter);
      o.start();
      this.voices.push(o);
    });
  }

  /** Fades in and starts the progression. */
  start(): void {
    const t = this.ctx.currentTime;
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(1, t + 4);
    this.timers.push(window.setInterval(() => this.nextChord(), CHORD_SECONDS * 1000));
    this.timers.push(window.setInterval(() => Math.random() < 0.55 && this.sparkle(), 5200));
  }

  /** Muffled and softer while the world is stopped at a safepoint. */
  setHushed(hushed: boolean): void {
    const t = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(hushed ? 380 : 1400, t, 0.12);
    this.out.gain.setTargetAtTime(hushed ? 0.55 : 1, t, 0.15);
  }

  private nextChord(): void {
    this.chord = (this.chord + 1) % PROGRESSION.length;
    const t = this.ctx.currentTime;
    PROGRESSION[this.chord].forEach((note, i) => this.voices[i].frequency.setTargetAtTime(midiToHz(note), t + i * 0.25, 0.9));
  }

  /** A single soft, high bell note, echoing away. */
  private sparkle(): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = midiToHz(SPARKLE[Math.floor(Math.random() * SPARKLE.length)]);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.018, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(g).connect(this.filter);
    o.start(t);
    o.stop(t + 2.3);
  }
}
