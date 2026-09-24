// "How to read this world": the colour and motion code of the scene, in one
// place. Every row opens the hotspot it describes.

import type { HotspotId } from '../content';
import { C } from '../view/fx';
import { ROLE_COLOR } from '../view/heapView';
import { LOADER_COLOR } from '../view/loadingView';
import { TIER_COLOR } from '../view/threadsView';
import { button, h } from './dom';

type Swatch = 'dot' | 'square' | 'bar' | 'stream';
interface Row {
  color: { getHexString(): string } | string;
  label: string;
  id: HotspotId;
  swatch?: Swatch;
}

const hex = (c: Row['color']) => (typeof c === 'string' ? c : `#${c.getHexString()}`);

const SECTIONS: [string, Row[]][] = [
  [
    'Heap regions (tiles) and objects (cubes)',
    [
      { color: ROLE_COLOR.eden, label: 'Eden: newly allocated objects', id: 'eden', swatch: 'square' },
      { color: ROLE_COLOR.survivor, label: 'Survivor: survived a young GC', id: 'survivor', swatch: 'square' },
      { color: ROLE_COLOR.old, label: 'Old: long-lived objects', id: 'old', swatch: 'square' },
      { color: ROLE_COLOR.humongous, label: 'Humongous: one giant array', id: 'humongous', swatch: 'square' },
      { color: C.dead, label: 'Grey cube: garbage, unreachable', id: 'gc', swatch: 'square' },
    ],
  ],
  [
    'Stack frames (slabs in the thread towers)',
    [
      { color: TIER_COLOR[0], label: 'Interpreted', id: 'interpreter', swatch: 'bar' },
      { color: TIER_COLOR[3], label: 'Compiled by C1 (with profiling)', id: 'c1', swatch: 'bar' },
      { color: TIER_COLOR[4], label: 'Compiled by C2 (optimised)', id: 'c2', swatch: 'bar' },
      { color: C.ice, label: 'Ice: frozen at a safepoint (GC pause)', id: 'gc', swatch: 'bar' },
    ],
  ],
  [
    'Classes (loader rings and Metaspace crystals)',
    [
      { color: LOADER_COLOR.bootstrap, label: 'Bootstrap loader: the JDK core', id: 'classloaders' },
      { color: LOADER_COLOR.platform, label: 'Platform loader: other JDK modules', id: 'classloaders' },
      { color: LOADER_COLOR.app, label: 'Application loader: your code', id: 'classloaders' },
    ],
  ],
  [
    'Streams of particles',
    [
      { color: '#cfe8ff', label: 'Source code into the compiler', id: 'compiler', swatch: 'stream' },
      { color: C.interp, label: 'Bytecode, Metaspace → interpreter', id: 'interpreter', swatch: 'stream' },
      { color: C.eden, label: 'Allocations, threads → Eden', id: 'eden', swatch: 'stream' },
      { color: C.c2, label: 'Compiled code, code cache → threads', id: 'codecache', swatch: 'stream' },
      { color: C.native, label: 'Native calls through the portal', id: 'native', swatch: 'stream' },
      { color: C.gold, label: 'AOT cache pre-filling the JVM', id: 'aotcache', swatch: 'stream' },
    ],
  ],
  [
    'Sparks (one-off events)',
    [
      { color: C.c1, label: 'Green: a warm method sent to C1', id: 'c1' },
      { color: C.c2, label: 'Orange: a hot method sent to C2', id: 'c2' },
      { color: C.deopt, label: 'Red: deoptimisation, back to the interpreter', id: 'deopt' },
    ],
  ],
  [
    'Virtual threads (violet lights)',
    [
      { color: C.vthread, label: 'Circling: queued, waiting for a carrier', id: 'vthreads' },
      { color: '#ffffff', label: 'Big, on a carrier tower: running', id: 'carriers' },
      { color: '#4b3d63', label: 'Dim, on the heap: parked (blocked)', id: 'vthreads' },
    ],
  ],
];

export class Legend {
  constructor(
    private readonly root: HTMLElement,
    onPick: (id: HotspotId) => void,
  ) {
    root.replaceChildren(
      h('div', { class: 'legend-head' }, h('h2', {}, 'How to read this world'), button('✕', () => this.close(), { class: 'close', 'aria-label': 'Close' })),
      h(
        'div',
        { class: 'legend-grid' },
        ...SECTIONS.map(([title, rows]) =>
          h(
            'section',
            {},
            h('h3', {}, title),
            ...rows.map((r) => button(`<i class="sw ${r.swatch ?? 'dot'}" style="--c:${hex(r.color)}"></i>${r.label}`, () => onPick(r.id))),
          ),
        ),
      ),
    );
  }

  toggle(): void {
    this.root.classList.toggle('open');
  }

  close(): void {
    this.root.classList.remove('open');
  }
}
