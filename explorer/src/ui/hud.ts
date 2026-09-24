// A pretend Java Flight Recorder: live numbers from the simulated JVM, and a
// stream of events (compilations, collections, class loads) as they happen.

import type { HotspotId } from '../content';
import type { RegionRole } from '../sim/heap';
import type { Stats } from '../sim/jvm';
import { formatBytes } from '../format';
import { h } from './dom';

const ROLES: readonly RegionRole[] = ['eden', 'survivor', 'old', 'humongous', 'free'];
const FEED_MAX = 6;

export class Hud {
  private readonly bar = h('div', { class: 'heapbar' });
  private readonly rows = h('dl', {});

  constructor(root: HTMLElement, onOpen: () => void) {
    root.replaceChildren(
      h('div', { class: 'hud-title' }, h('i', { class: 'rec' }), 'JFR · live'),
      this.bar,
      this.rows,
    );
    root.addEventListener('click', onOpen);
  }

  update(s: Stats): void {
    const total = ROLES.reduce((n, r) => n + s.regions[r], 0);
    this.bar.replaceChildren(...ROLES.map((r) => h('span', { class: r, style: `flex:${s.regions[r] / total}` })));
    const rows: [string, string][] = [
      ['Heap', `${total - s.regions.free}/${total} regions · ${formatBytes(s.heapUsedBytes)}`],
      ['GC', `${s.collector} · ${s.gcCount} · ${s.lastPauseMs === null ? '–' : `${s.lastPauseMs} ms`}`],
      ['JIT', `C1 ${s.c1} · C2 ${s.c2} · deopts ${s.deopts}`],
      ['Classes', `${s.classesLoaded}`],
      ['Virtual', `${s.vthreads} (${s.vMounted} mounted)`],
    ];
    this.rows.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  }
}

export class Feed {
  constructor(
    private readonly root: HTMLElement,
    private readonly onOpen: (id: HotspotId) => void,
  ) {}

  push(html: string, color: string, id: HotspotId): void {
    const line = h('div', { class: 'ev', style: `--c:${color}`, html });
    line.addEventListener('click', () => this.onOpen(id));
    this.root.prepend(line);
    while (this.root.children.length > FEED_MAX) this.root.lastElementChild!.remove();
    window.setTimeout(() => line.classList.add('old'), 6000);
  }
}
