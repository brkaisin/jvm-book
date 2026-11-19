import { describe, expect, it } from 'vitest';
import { declutter } from '../src/view/declutter';

const box = (x: number, y: number, priority = 1, w = 100, h = 20) => ({ x, y, w, h, priority });

describe('declutter', () => {
  it('keeps labels that do not touch', () => {
    expect(declutter([box(0, 0), box(200, 0), box(0, 100)])).toEqual([true, true, true]);
  });

  it('hides the less important of two overlapping labels', () => {
    expect(declutter([box(0, 0, 1), box(50, 5, 5)])).toEqual([false, true]);
  });

  it('lets a hidden label free the room it would have blocked', () => {
    // b hides behind a; c only overlapped b, so it stays.
    expect(declutter([box(0, 0, 9), box(60, 0, 5), box(130, 0, 1)])).toEqual([true, false, true]);
  });

  it('treats labels that only just touch as overlapping', () => {
    expect(declutter([box(0, 0, 2), box(101, 0, 1)])).toEqual([true, false]);
  });
});
