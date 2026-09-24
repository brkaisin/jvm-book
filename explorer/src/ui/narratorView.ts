// The narrator's face: a small glowing avatar that moves while it talks, and
// subtitles showing the sentence being spoken, word by word.

import type { NarratorListener } from '../audio/narrator';
import { h } from './dom';

/** Start offsets of the sentences in `text`. */
export function sentenceStarts(text: string): number[] {
  const starts = [0];
  for (const m of text.matchAll(/[.!?:]\s+(?=\S)/g)) starts.push(m.index + m[0].length);
  return starts;
}

export class NarratorView implements NarratorListener {
  private readonly spoken = h('span', { class: 'spoken' });
  private readonly rest = h('span', {});
  private text = '';
  private starts: number[] = [0];

  constructor(private readonly root: HTMLElement) {
    root.replaceChildren(
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, ...Array.from({ length: 5 }, () => h('i'))),
      h('p', { class: 'caption' }, this.spoken, this.rest),
    );
  }

  start(text: string, voiced: boolean): void {
    this.text = text;
    this.starts = sentenceStarts(text);
    if (voiced) this.word(0);
    else {
      this.spoken.textContent = text;
      this.rest.textContent = '';
    }
    this.root.classList.add('open', 'talking');
  }

  word(index: number): void {
    // Show only the current sentence; what has been said so far is brighter.
    let s = 0;
    while (s + 1 < this.starts.length && this.starts[s + 1] <= index) s++;
    const from = this.starts[s];
    const to = this.starts[s + 1] ?? this.text.length;
    const wordEnd = this.text.indexOf(' ', index + 1);
    const cut = Math.min(to, wordEnd < 0 ? this.text.length : wordEnd);
    this.spoken.textContent = this.text.slice(from, index === 0 ? from : cut);
    this.rest.textContent = this.text.slice(index === 0 ? from : cut, to);
  }

  end(): void {
    this.root.classList.remove('talking', 'open');
  }
}
