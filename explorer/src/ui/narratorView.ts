// The narrator's face: a small avatar that moves while it talks, the topic it
// is talking about, subtitles following the voice sentence by sentence, a
// choice of voice, and buttons to skip or stop it.

import type { Line, NarratorListener } from '../audio/narrator';
import { voiceLabel } from '../audio/voices';
import { button, h } from './dom';

/** Start offsets of the sentences in `text`. */
export function sentenceStarts(text: string): number[] {
  const starts = [0];
  for (const m of text.matchAll(/[.!?:]\s+(?=\S)/g)) starts.push(m.index + m[0].length);
  return starts;
}

export interface NarratorControls {
  skip(): void;
  stop(): void;
  setVoice(name: string): void;
}

export class NarratorView implements NarratorListener {
  private readonly topic = h('div', { class: 'topic' });
  private readonly spoken = h('span', { class: 'spoken' });
  private readonly rest = h('span', {});
  private readonly waiting = h('span', { class: 'waiting' });
  private readonly voicePicker = h('select', { class: 'voice', title: 'Pick another voice', 'aria-label': 'Voice', hidden: true });
  private text = '';
  private starts: number[] = [0];
  private controls: NarratorControls | null = null;

  constructor(private readonly root: HTMLElement) {
    root.replaceChildren(
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, ...Array.from({ length: 5 }, () => h('i'))),
      h('div', { class: 'talk' }, this.topic, h('p', { class: 'caption' }, this.spoken, this.rest)),
      h(
        'div',
        { class: 'narrator-actions' },
        this.waiting,
        this.voicePicker,
        button('⏭', () => this.controls?.skip(), { title: 'Skip this explanation', 'aria-label': 'Skip' }),
        button('⏹', () => this.controls?.stop(), { title: 'Stop talking (turn the voice off with N)', 'aria-label': 'Stop' }),
      ),
    );
    this.voicePicker.addEventListener('change', () => this.controls?.setVoice(this.voicePicker.value));
  }

  voices(voices: SpeechSynthesisVoice[], current: SpeechSynthesisVoice | null): void {
    // A handful is plenty: past the first few, voices only get more robotic.
    const shown = voices.slice(0, 8);
    if (current && !shown.includes(current)) shown.push(current);
    this.voicePicker.replaceChildren(...shown.map((v) => h('option', { value: v.name, selected: v === current }, voiceLabel(v))));
    this.voicePicker.hidden = shown.length < 2;
  }

  /** The buttons need the narrator, which needs this view: wired after both exist. */
  bind(controls: NarratorControls): void {
    this.controls = controls;
  }

  start(line: Line, voiced: boolean, interrupted: boolean): void {
    this.text = line.text;
    this.starts = sentenceStarts(line.text);
    this.topic.textContent = line.topic;
    if (voiced) this.word(0);
    else {
      this.spoken.textContent = line.text;
      this.rest.textContent = '';
    }
    this.root.classList.add('open', 'talking');
    // Make a change of subject obvious rather than a silent swap.
    this.root.classList.remove('switched');
    if (interrupted) {
      void this.root.offsetWidth; // restart the animation
      this.root.classList.add('switched');
    }
  }

  word(index: number): void {
    // Show only the current sentence; what has been said so far is brighter.
    let s = 0;
    while (s + 1 < this.starts.length && this.starts[s + 1] <= index) s++;
    const from = this.starts[s];
    const to = this.starts[s + 1] ?? this.text.length;
    const wordEnd = this.text.indexOf(' ', index + 1);
    const cut = index === from ? from : Math.min(to, wordEnd < 0 ? this.text.length : wordEnd);
    this.spoken.textContent = this.text.slice(from, cut);
    this.rest.textContent = this.text.slice(cut, to);
  }

  queued(n: number): void {
    this.waiting.textContent = n ? `+${n} waiting` : '';
  }

  end(): void {
    this.root.classList.remove('talking', 'open', 'switched');
  }
}
