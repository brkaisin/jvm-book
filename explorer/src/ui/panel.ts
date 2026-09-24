// The side panel explaining one hotspot, with live numbers from the running
// simulation, action buttons, and links into the book.

import { AREAS, HOTSPOTS, type ActionId, type Hotspot, type HotspotId } from '../content';
import { button, h } from './dom';

export interface PanelHandlers {
  action(a: ActionId): void;
  close(): void;
  live(id: HotspotId): [string, string][] | null;
}

export class Panel {
  private id: HotspotId | null = null;
  private liveEl: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly on: PanelHandlers,
  ) {}

  get current(): HotspotId | null {
    return this.id;
  }

  show(id: HotspotId): void {
    const hs: Hotspot = HOTSPOTS[id];
    const area = AREAS[hs.area];
    this.id = id;
    this.liveEl = h('dl', { class: 'live' });
    const body = h(
      'div',
      { class: 'panel-body' },
      h('div', { class: 'chip', style: `--c:${area.color}` }, area.label),
      h('h2', {}, hs.title),
      h('div', { class: 'see' }, h('b', {}, 'What you’re seeing'), h('span', { html: hs.see })),
      h('p', { class: 'summary', html: hs.summary }),
      hs.extra ? h('div', { class: 'extra', html: hs.extra }) : null,
      this.liveEl,
      hs.actions?.length
        ? h('div', { class: 'actions' }, ...hs.actions.map(([label, a]) => button(label, () => this.on.action(a), { class: 'act' })))
        : null,
      hs.fact ? h('p', { class: 'fact', html: `<b>Did you know?</b> ${hs.fact}` }) : null,
      h(
        'div',
        { class: 'links' },
        h('div', { class: 'links-title' }, 'Read more in the book'),
        ...hs.links.map(([label, href]) => h('a', { href, target: '_top' }, h('span', {}, label), h('i', { html: '→' }))),
      ),
    );
    this.root.replaceChildren(button('✕', () => this.on.close(), { class: 'close', 'aria-label': 'Close' }), body);
    this.root.style.setProperty('--c', area.color);
    this.root.classList.add('open');
    this.root.scrollTop = 0;
    this.refresh();
  }

  hide(): void {
    this.id = null;
    this.liveEl = null;
    this.root.classList.remove('open');
  }

  /** Re-renders the live numbers; cheap enough to call a few times per second. */
  refresh(): void {
    if (!this.id || !this.liveEl) return;
    const rows = this.on.live(this.id);
    this.liveEl.hidden = !rows;
    if (!rows) return;
    this.liveEl.replaceChildren(
      h('div', { class: 'live-title' }, h('i', { class: 'rec' }), 'Live'),
      ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]),
    );
  }
}
