// Shows the story's "what just happened?" moments, one at a time.

import type { HotspotId } from '../content';
import type { Moment } from '../story';
import { button, h } from './dom';

const SHOW_SECONDS = 16;

export class MomentCard {
  private readonly queue: Moment[] = [];
  private current: Moment | null = null;
  private timer: number | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly onShow: (id: HotspotId) => void,
    /** Called when a moment appears (to narrate it). */
    private readonly onDisplay: (m: Moment) => void = () => {},
  ) {
    // Reading takes time: do not auto-dismiss while the pointer is on the card.
    root.addEventListener('pointerenter', () => window.clearTimeout(this.timer));
    root.addEventListener('pointerleave', () => this.current && this.arm());
  }

  push(m: Moment): void {
    this.queue.push(m);
    if (!this.current) this.next();
  }

  dismiss(): void {
    this.root.classList.remove('open');
    this.current = null;
    window.clearTimeout(this.timer);
    window.setTimeout(() => this.next(), 500);
  }

  private next(): void {
    const m = this.queue.shift();
    if (!m || this.current) return;
    this.current = m;
    this.root.replaceChildren(
      h('div', { class: 'kicker' }, 'What just happened?'),
      h('h3', {}, m.title),
      h('p', { html: m.text }),
      h(
        'div',
        { class: 'row' },
        button('Show me →', () => {
          this.onShow(m.hotspot);
          this.dismiss();
        }, { class: 'act' }),
        button('Got it', () => this.dismiss(), { class: 'ghost' }),
      ),
    );
    this.root.classList.add('open');
    this.onDisplay(m);
    this.arm();
  }

  private arm(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.dismiss(), SHOW_SECONDS * 1000);
  }
}
