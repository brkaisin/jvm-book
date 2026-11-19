// Everything the narrator says, in one place. The lines are recorded ahead of
// time with natural voices (see scripts/narrate.mjs), so they must be known in
// advance: a line built from runtime values (a method name, a count) would
// have no recording. Keep such details in the topic or the feed instead.

import { HOTSPOTS, TOUR, type HotspotId, type TourStep } from './content';
import { MOMENTS, type Moment } from './story';
import { SAMPLES, type Sample } from './lang/samples';

export const LINES = {
  voiceSample: 'Hi! This is how I sound.',
  labRunning: 'Running your code. Watch the gold tower and the heap.',
  labWarm: 'One of your methods is warm: C1 just compiled it. Its frames turn green, and it runs about four times faster.',
  labHot: 'One of your methods is hot: C2 recompiled it with full optimisations. Orange frames, and it flies.',
  labFinished: 'Your program finished. Its objects are now garbage: the next collection will reclaim them.',
} as const;

/** Why the Code Lab's program crashed, for the exceptions it can throw. */
export const CRASHES: Record<string, string> = {
  StackOverflowError: 'StackOverflowError! Every call pushed a new frame, and the stack ran out of room. The tower hit the ceiling.',
  ArithmeticException: 'ArithmeticException! An integer division by zero: the JVM throws instead of returning a value.',
  NullPointerException: 'NullPointerException! The code used a reference that points to nothing.',
  ArrayIndexOutOfBoundsException: 'ArrayIndexOutOfBoundsException! The code read past the end of an array: the JVM checks every array access.',
};

export const hotspotLine = (id: HotspotId): string => HOTSPOTS[id].summary;
export const tourLine = (step: TourStep): string => `${step.say} ${HOTSPOTS[step.id].see}`;
export const momentLine = (m: Pick<Moment, 'title' | 'text'>): string => `${/[.!?]$/.test(m.title) ? m.title : `${m.title}.`} ${m.text}`;
export const sampleLine = (s: Sample): string => `Watch ${s.watch}.`;

/** Every line the narrator can say, as HTML. */
export function allLines(): string[] {
  return [
    ...Object.values(LINES),
    ...Object.values(CRASHES),
    ...(Object.keys(HOTSPOTS) as HotspotId[]).map(hotspotLine),
    ...TOUR.map(tourLine),
    ...Object.values(MOMENTS).map(momentLine),
    ...SAMPLES.map(sampleLine),
  ];
}
