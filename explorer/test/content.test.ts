import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AREAS, HOTSPOTS, TOUR } from '../src/content';

/** The book sources; the explorer is served from docs/explorer/. */
const DOCS = resolve(__dirname, '../../docs');
const EXPLORER = resolve(DOCS, 'explorer');

/** mdBook's heading id: lowercase, keep letters/digits/_/-, spaces become dashes. */
export const slug = (heading: string) =>
  heading
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '');

function anchorsOf(mdFile: string): Set<string> {
  const md = readFileSync(mdFile, 'utf8').replace(/```[\s\S]*?```/g, '');
  return new Set([...md.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1])));
}

describe('content', () => {
  it('slug matches mdBook for tricky headings', () => {
    expect(slug('The Heap — Where Objects Live')).toBe('the-heap--where-objects-live');
    expect(slug('Step 5: Execution — Interpreter + JIT')).toBe('step-5-execution--interpreter--jit');
    expect(slug('A Glimpse of Valhalla <span class="preview">Preview in 28</span>')).toBe('a-glimpse-of-valhalla-preview-in-28');
  });

  const links = Object.entries(HOTSPOTS).flatMap(([id, h]) => h.links.map(([label, href]) => ({ id, label, href })));

  it.each(links)('$id → $href points to a real chapter and section', ({ href }) => {
    const [path, anchor] = href.split('#');
    const md = resolve(EXPLORER, path).replace(/\.html$/, '.md');
    expect(existsSync(md), `missing ${md}`).toBe(true);
    if (anchor) expect([...anchorsOf(md)]).toContain(anchor);
  });

  it('every hotspot has a known area, a summary and at least one link', () => {
    for (const h of Object.values(HOTSPOTS)) {
      expect(AREAS[h.area]).toBeDefined();
      expect(h.summary.length).toBeGreaterThan(40);
      expect(h.links.length).toBeGreaterThan(0);
    }
  });

  it('the tour visits distinct hotspots', () => {
    const ids = TOUR.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(HOTSPOTS[id]).toBeDefined();
  });
});
