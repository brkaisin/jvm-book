// Keeps the floating labels readable: when two of them overlap on screen, the
// more important one stays and the other fades out until there is room again.
// Pure geometry, so it can be tested without a browser.

export interface LabelBox {
  /** Centre on screen, in pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Higher wins. */
  priority: number;
}

/** Breathing room around each label, in pixels. */
const GAP = 3;

/** Which boxes to show: the most important first, then any that fit beside them. */
export function declutter(boxes: readonly LabelBox[]): boolean[] {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[b].priority - boxes[a].priority);
  const kept: LabelBox[] = [];
  const show = boxes.map(() => false);
  for (const i of order) {
    const b = boxes[i];
    const clash = kept.some((k) => Math.abs(k.x - b.x) * 2 < k.w + b.w + GAP * 2 && Math.abs(k.y - b.y) * 2 < k.h + b.h + GAP * 2);
    if (clash) continue;
    kept.push(b);
    show[i] = true;
  }
  return show;
}
