// Shows the story's "what just happened?" moments, one at a time. The app
// only lets a moment through when the screen is quiet (see `Story`), so there
// is no queue: a note that cannot be shown now waits for the event to happen
// again, when it is still worth explaining.

import type { HotspotId } from '../content';
import type { Moment } from '../story';
import { button, h } from './dom';

const SHOW_SECONDS = 16;

export class MomentCard {
  private current: Moment | null = null;
  private timer: number | undefined;
  /** When the last note went away (performance.now() milliseconds). */
  private closedAt = -Infinity;

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

  /** Whether a note is on screen. */
  get busy(): boolean {
    return this.current !== null;
  }

  /** Seconds since the last note went away. */
  get quietSeconds(): number {
    return (performance.now() - this.closedAt) / 1000;
  }

  show(m: Moment): void {
    if (this.current) return;
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

  dismiss(): void {
    if (!this.current) return;
    this.root.classList.remove('open');
    this.current = null;
    this.closedAt = performance.now();
    window.clearTimeout(this.timer);
  }

  private arm(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.dismiss(), SHOW_SECONDS * 1000);
  }
}
