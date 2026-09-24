// The "map": every hotspot, grouped by area. Handy on touch screens and for
// anyone who prefers a list to a 3D scene.

import { AREAS, HOTSPOTS, type AreaId, type HotspotId } from '../content';
import { button, h } from './dom';

export class MapMenu {
  constructor(
    private readonly root: HTMLElement,
    onPick: (id: HotspotId) => void,
  ) {
    const byArea = new Map<AreaId, HotspotId[]>();
    for (const [id, hs] of Object.entries(HOTSPOTS) as [HotspotId, (typeof HOTSPOTS)[HotspotId]][]) {
      byArea.set(hs.area, [...(byArea.get(hs.area) ?? []), id]);
    }
    root.replaceChildren(
      h('div', { class: 'map-title' }, 'Everything in this JVM'),
      ...[...byArea].map(([area, ids]) =>
        h(
          'section',
          { style: `--c:${AREAS[area].color}` },
          h('h3', {}, AREAS[area].label),
          ...ids.map((id) =>
            button(HOTSPOTS[id].title, () => {
              onPick(id);
              if (window.matchMedia('(max-width: 800px)').matches) this.close();
            }),
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
