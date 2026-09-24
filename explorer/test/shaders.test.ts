// GLSL pitfalls that are harmless in software renderers but produce NaN (and
// then black squares through bloom) on real GPUs.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../src');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith('.ts') ? [join(dir, d.name)] : []));

/** Every GLSL snippet: template literals tagged with a glsl comment. */
const shaders = files(SRC).flatMap((f) =>
  [...readFileSync(f, 'utf8').matchAll(/\/\* glsl \*\/ `([\s\S]*?)`/g)].map((m) => ({ file: f.slice(SRC.length + 1), code: m[1] })),
);

describe('shaders', () => {
  it('finds the shaders', () => {
    expect(shaders.length).toBeGreaterThan(6);
  });

  it.each(shaders)('$file: smoothstep edges are increasing (reversed edges are undefined in GLSL)', ({ code }) => {
    for (const m of code.matchAll(/smoothstep\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,/g)) expect(Number(m[1])).toBeLessThan(Number(m[2]));
  });

  it.each(shaders)('$file: pow() bases are clamped (a negative base is NaN)', ({ code }) => {
    for (const m of code.matchAll(/pow\(([^,]+)/g)) expect(m[1]).toMatch(/^\s*(clamp|max|abs)\(|^\s*[\d.]+\s*$/);
  });

  it.each(shaders)('$file: no division by a raw derivative', ({ code }) => {
    expect(code).not.toMatch(/\/\s*fwidth\(/);
  });
});
