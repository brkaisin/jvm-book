// Every sound is synthesised with Web Audio: no audio files. A soft ambient
// pad plays in the background (muffled while the world is stopped at a
// safepoint, see ambient.ts); short cues mark events: chimes for
// compilations, a buzz for deoptimisation, a whoosh for collections...

import { Ambient } from './ambient';

export type Cue =
  | 'none'
  | 'click'
  | 'toggle'
  | 'spawn'
  | 'call'
  | 'alloc'
  | 'load'
  | 'native'
  | 'jfr'
  | 'c1'
  | 'c2'
  | 'deopt'
  | 'gcFreeze'
  | 'gcConcurrent'
  | 'gcDone'
  | 'mount'
  | 'moment';

/** Minimum seconds between two plays of the same cue, so bursts stay pleasant. */
const MIN_GAP: Partial<Record<Cue, number>> = { c1: 0.25, c2: 0.4, mount: 0.35, load: 0.3, alloc: 0.2, click: 0.05 };

/** A major pentatonic scale over two octaves, for sparkly cues. */
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];

type Wave = OscillatorType;

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambient: Ambient | null = null;
  private readonly last = new Map<Cue, number>();
  private frozen = false;
  private on: boolean;

  constructor(enabled = true) {
    this.on = enabled;
  }

  get enabled(): boolean {
    return this.on;
  }

  /** Must be called from a user gesture (browsers block audio before one). */
  unlock(): void {
    if (this.ctx || typeof AudioContext === 'undefined') return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.on ? 0.6 : 0;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    this.ambient = new Ambient(this.ctx, this.master);
    this.ambient.start();
  }

  setEnabled(on: boolean): void {
    this.on = on;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(on ? 0.6 : 0, this.ctx.currentTime, 0.15);
  }

  /** The music goes muffled while threads are stopped at a safepoint. */
  setFrozen(frozen: boolean): void {
    if (!this.ctx || frozen === this.frozen) return;
    this.frozen = frozen;
    this.ambient?.setHushed(frozen);
  }

  play(cue: Cue): void {
    const ctx = this.ctx;
    if (!ctx || !this.on || cue === 'none') return;
    const now = ctx.currentTime;
    const gap = MIN_GAP[cue] ?? 0.08;
    if (now - (this.last.get(cue) ?? -1) < gap) return;
    this.last.set(cue, now);

    switch (cue) {
      case 'click':
        this.tone(1400, 0.04, 'sine', 0.05);
        break;
      case 'toggle':
        this.tone(440, 0.09, 'triangle', 0.12);
        this.tone(660, 0.14, 'triangle', 0.12, 0.08);
        break;
      case 'spawn':
        for (let i = 0; i < 6; i++) this.tone(PENTA[(i * 3) % PENTA.length] * 1.5, 0.12, 'triangle', 0.06, i * 0.05);
        break;
      case 'call':
        this.tone(330, 0.12, 'triangle', 0.1, 0, 660);
        break;
      case 'alloc':
        for (let i = 0; i < 10; i++) this.tone(1800 + Math.random() * 1600, 0.03, 'sine', 0.035, i * 0.035);
        break;
      case 'load':
        this.tone(220, 0.35, 'sine', 0.12, 0, 440);
        this.bell(880, 0.6, 0.08, 0.25);
        break;
      case 'native':
        this.tone(220, 0.8, 'triangle', 0.06, 0, 110, 900);
        this.bell(1318.5, 0.5, 0.05, 0.4);
        break;
      case 'jfr':
        this.noise(0.07, 3000, 0.12, 'highpass');
        this.tone(2400, 0.03, 'sine', 0.03, 0.02);
        break;
      case 'c1':
        this.bell(659.25, 0.5, 0.09);
        this.bell(987.77, 0.6, 0.07, 0.09);
        break;
      case 'c2':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.bell(f, 0.9, 0.07, i * 0.07));
        break;
      case 'deopt':
        this.tone(440, 0.55, 'triangle', 0.08, 0, 147, 1200);
        break;
      case 'gcFreeze':
        this.noise(0.6, 900, 0.1, 'bandpass', 3200);
        this.bell(261.63, 0.9, 0.05);
        break;
      case 'gcConcurrent':
        this.noise(0.9, 600, 0.07, 'bandpass', 2000);
        break;
      case 'gcDone':
        this.bell(392, 0.7, 0.06);
        break;
      case 'mount':
        this.tone(PENTA[Math.floor(Math.random() * PENTA.length)] * 2, 0.08, 'sine', 0.025);
        break;
      case 'moment':
        this.bell(784, 0.5, 0.07);
        this.bell(1175, 0.7, 0.06, 0.12);
        break;
    }
  }

  // ------------------------------------------------------------- building blocks

  /** A note with a quick attack, optionally gliding in pitch and through a lowpass. */
  private tone(freq: number, dur: number, type: Wave, gain: number, delay = 0, glideTo?: number, lowpass?: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out: AudioNode = o.connect(g);
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      out = out.connect(f);
    }
    out.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** A bell-like sine with a long, soft decay. */
  private bell(freq: number, dur: number, gain: number, delay = 0): void {
    this.tone(freq, dur, 'sine', gain, delay);
    this.tone(freq * 2.01, dur * 0.5, 'sine', gain * 0.3, delay);
  }

  /** Filtered white noise: whooshes and shutters. */
  private noise(dur: number, freq: number, gain: number, type: BiquadFilterType, sweepTo?: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }
}
