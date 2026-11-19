// The narrator's face: a small pill with an avatar that moves while it talks,
// the topic it is talking about, a thin line showing how far along it is, and
// buttons to skip or stop it. Subtitles follow the voice sentence by sentence,
// but only when the words are not already written somewhere on screen (the
// stylesheet hides them next to an open panel, tour card or note). The voice
// picker lives in the settings menu: `voicePicker` is mounted there.

import type { Line, NarratorListener } from '../audio/narrator';
import type { Voice } from '../audio/voices';
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
  setVoice(id: string): void;
}

export class NarratorView implements NarratorListener {
  private readonly topic = h('div', { class: 'topic' });
  private readonly spoken = h('span', { class: 'spoken' });
  private readonly rest = h('span', {});
  private readonly waiting = h('span', { class: 'waiting' });
  private readonly progress = h('i', { class: 'progress', 'aria-hidden': 'true' });
  readonly voicePicker = h('select', { class: 'voice', title: 'Pick another voice', 'aria-label': 'Voice', hidden: true });
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
        button('⏭', () => this.controls?.skip(), { title: 'Skip this explanation', 'aria-label': 'Skip' }),
        button('⏹', () => this.controls?.stop(), { title: 'Stop talking (turn the voice off with N)', 'aria-label': 'Stop' }),
      ),
      this.progress,
    );
    this.voicePicker.addEventListener('change', () => this.controls?.setVoice(this.voicePicker.value));
  }

  voices(voices: readonly Voice[], current: Voice): void {
    this.voicePicker.replaceChildren(...voices.map((v) => h('option', { value: v.id, selected: v === current }, v.label)));
    this.voicePicker.hidden = voices.length < 2;
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
    this.root.classList.toggle('voiced', voiced);
    this.progress.style.transform = 'scaleX(0)';
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
    if (this.text) this.progress.style.transform = `scaleX(${Math.min(1, index / this.text.length).toFixed(3)})`;
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
