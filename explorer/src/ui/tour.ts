// The guided tour: a narrated sequence of hotspots, with optional autoplay.

import { HOTSPOTS, TOUR, type TourStep } from '../content';
import { button, h } from './dom';

const AUTOPLAY_SECONDS = 11;

export class Tour {
  private index = -1;
  private timer: number | undefined;
  private readonly say = h('p', { class: 'say' });
  private readonly count = h('span', { class: 'count' });
  private readonly play: HTMLButtonElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly onStep: (step: TourStep) => void,
    private readonly onEnd: () => void,
  ) {
    this.play = button('▶', () => this.toggleAutoplay(), { class: 'play', title: 'Autoplay' });
    root.replaceChildren(
      h(
        'div',
        { class: 'tour-row' },
        button('◀', () => this.prev(), { title: 'Previous (←)' }),
        this.count,
        button('▶▶', () => this.next(), { title: 'Next (→)', class: 'next' }),
        this.play,
        button('✕', () => this.stop(), { title: 'End tour', class: 'end' }),
      ),
      this.say,
    );
  }

  get active(): boolean {
    return this.index >= 0;
  }

  start(): void {
    this.root.classList.add('open');
    this.go(0);
  }

  stop(): void {
    if (!this.active) return;
    this.index = -1;
    this.setAutoplay(false);
    this.root.classList.remove('open');
    this.onEnd();
  }

  next(): void {
    if (this.index < TOUR.length - 1) this.go(this.index + 1);
    else this.stop();
  }

  prev(): void {
    if (this.index > 0) this.go(this.index - 1);
  }

  /** The user wandered off (clicked something else): leave the tour. */
  interrupt(): void {
    this.stop();
  }

  private go(i: number): void {
    this.index = i;
    const step = TOUR[i];
    this.count.textContent = `${i + 1} / ${TOUR.length}`;
    this.say.innerHTML = `<b>${HOTSPOTS[step.id].title}.</b> ${step.say}`;
    this.onStep(step);
    if (this.timer !== undefined) this.setAutoplay(true);
  }

  private toggleAutoplay(): void {
    this.setAutoplay(this.timer === undefined);
  }

  private setAutoplay(on: boolean): void {
    window.clearInterval(this.timer);
    this.timer = on ? window.setInterval(() => this.next(), AUTOPLAY_SECONDS * 1000) : undefined;
    this.play.textContent = on ? '❚❚' : '▶';
    this.root.classList.toggle('autoplay', on);
  }
}
