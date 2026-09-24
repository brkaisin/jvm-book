// Where everything sits in the world. One place, so views, flows and camera
// anchors never disagree. Units are arbitrary; y is up, the floor is y = 0.

import { Vector3 } from 'three';
import { HEAP_COLS, HEAP_ROWS } from '../sim/heap';

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

export const LAYOUT = {
  // Outside the JVM, on the left
  source: v(-100, 8, 4),
  compiler: v(-84, 8, 0),
  classfile: v(-74, 8, 0),

  // Class loading
  loaders: v(-54, 8, 0),
  verifier: v(-45, 8, 0),
  modules: v(-55, 0, 15),
  aot: v(-56, 2.5, -15),
  metaspace: v(-27, 12, -25),

  // Memory
  heap: v(0, 0, -4),
  regionPitch: 3.3,
  regionTile: 3.0,
  direct: v(47, 0, 18),
  valhalla: v(-38, 0, 21),

  // Threads
  threadZ: 18,
  platformX: [-25, -20, -15, -10] as const,
  carrierX: [5, 10] as const,
  vqueue: v(7.5, 12, 18),
  framePitch: 0.62,
  towerBase: 1.3,

  // Execution engine
  interpreter: v(27, 7, 4),
  c1: v(39, 8, -4),
  c2: v(50, 10, -13),
  codecache: v(31, 0, -25),

  // Around
  portal: v(67, 8, 12),
  nativeWorld: v(86, 7, 12),
  gcHome: v(0, 12, -4),
  jfrOrbit: { radius: 64, y: 24 },
  hardwareY: -16,
  cpu: v(-7.5, -16, 18),
  ram: v(0, -16, -8),
  dome: { center: v(0, 0, -2), radii: v(72, 32, 50) },
} as const;

/** Centre of heap region `i` (row-major, HEAP_COLS per row). */
export function regionCenter(i: number, out = new Vector3()): Vector3 {
  const p = LAYOUT.regionPitch;
  const col = i % HEAP_COLS;
  const row = Math.floor(i / HEAP_COLS);
  return out.set(
    LAYOUT.heap.x + (col - (HEAP_COLS - 1) / 2) * p,
    LAYOUT.heap.y + 0.3,
    LAYOUT.heap.z + (row - (HEAP_ROWS - 1) / 2) * p,
  );
}

export const HEAP_SIZE = { w: HEAP_COLS * LAYOUT.regionPitch, d: HEAP_ROWS * LAYOUT.regionPitch };

/** Object slot position inside a region: a 4 x 4 grid, two layers high. */
export function slotPosition(region: number, slot: number, out = new Vector3()): Vector3 {
  regionCenter(region, out);
  const layer = Math.floor(slot / 16);
  const k = slot % 16;
  const s = 0.64;
  out.x += ((k % 4) - 1.5) * s;
  out.z += (Math.floor(k / 4) - 1.5) * s;
  out.y += 0.35 + layer * 0.5;
  return out;
}

/** Position of a thread tower's base; carriers come after platform threads. */
export function towerBase(threadIndex: number, out = new Vector3()): Vector3 {
  const xs = [...LAYOUT.platformX, ...LAYOUT.carrierX];
  return out.set(xs[threadIndex], 0, LAYOUT.threadZ);
}

/** Centre of stack frame `depth` (0 = bottom) on a tower. */
export function framePosition(threadIndex: number, depth: number, out = new Vector3()): Vector3 {
  towerBase(threadIndex, out);
  out.y = LAYOUT.towerBase + 0.35 + depth * LAYOUT.framePitch;
  return out;
}

/** The core each thread runs on (one per thread, for clarity). */
export function coreCenter(threadIndex: number, out = new Vector3()): Vector3 {
  towerBase(threadIndex, out);
  out.y = LAYOUT.hardwareY + 1;
  return out;
}
