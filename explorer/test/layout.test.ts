import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { HEAP_COLS, HUMONGOUS_REGIONS, REGION_COUNT, REGION_SLOTS } from '../src/sim/heap';
import { LAYOUT, regionCenter, slotPosition } from '../src/view/layout';
import { formatBytes } from '../src/format';

/** Is `p` inside the dome (an ellipsoid; only its upper half is drawn)? */
const insideDome = (p: Vector3) => {
  const { center, radii } = LAYOUT.dome;
  const d = p.clone().sub(center);
  return (d.x / radii.x) ** 2 + (d.y / radii.y) ** 2 + (d.z / radii.z) ** 2 < 1;
};

describe('layout', () => {
  it('keeps the source, the compiler and native code outside the JVM, everything else inside', () => {
    for (const k of ['source', 'compiler', 'nativeWorld'] as const) expect(insideDome(LAYOUT[k]), k).toBe(false);
    for (const k of ['loaders', 'verifier', 'metaspace', 'heap', 'interpreter', 'c1', 'c2', 'codecache', 'direct', 'aot'] as const)
      expect(insideDome(LAYOUT[k]), k).toBe(true);
  });

  it('puts the humongous regions next to each other on one row', () => {
    const [a, b] = HUMONGOUS_REGIONS;
    expect(b).toBe(a + 1);
    expect(Math.floor(a / HEAP_COLS)).toBe(Math.floor(b / HEAP_COLS));
  });

  it('gives every region a distinct place and keeps objects on their tile', () => {
    const seen = new Set<string>();
    for (let r = 0; r < REGION_COUNT; r++) {
      const c = regionCenter(r);
      seen.add(`${c.x},${c.z}`);
      for (let s = 0; s < REGION_SLOTS; s++) {
        const p = slotPosition(r, s);
        expect(Math.abs(p.x - c.x)).toBeLessThan(LAYOUT.regionTile / 2);
        expect(Math.abs(p.z - c.z)).toBeLessThan(LAYOUT.regionTile / 2);
      }
    }
    expect(seen.size).toBe(REGION_COUNT);
  });

  it('never stacks two slots of a region in the same spot', () => {
    const spots = new Set(Array.from({ length: REGION_SLOTS }, (_, s) => slotPosition(0, s).toArray().join()));
    expect(spots.size).toBe(REGION_SLOTS);
  });

  it('keeps the hardware below the floor', () => {
    expect(LAYOUT.hardwareY).toBeLessThan(0);
  });
});

describe('formatBytes', () => {
  it('uses B, KB and MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
