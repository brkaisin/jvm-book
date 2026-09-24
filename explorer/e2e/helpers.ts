import { expect, type Page } from '@playwright/test';

/** Collects console errors and uncaught exceptions for the whole test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export async function enter(page: Page, hash = '') {
  await page.goto(`/index.html?debug${hash}`);
  if (!hash) await page.click('#enter');
  await expect(page.locator('body')).toHaveClass(/entered/);
}

/** Waits until the camera has finished flying to its target (positions are stable). */
export async function cameraSettled(page: Page) {
  await page.waitForFunction(() => !(window as any).__jvm.app.rig.flying, null, { timeout: 20_000 });
  await page.waitForTimeout(300); // let damping settle
}

/**
 * Renders the scene into a float target and counts non-finite pixels: the
 * kind that bloom turns into spreading black squares.
 */
export async function nonFinitePixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const { THREE, renderer, scene, camera } = (window as any).__jvm;
    const w = 320;
    const h = 200;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    const buf = new Float32Array(w * h * 4);
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    rt.dispose();
    return buf.reduce((n: number, v: number) => n + (Number.isFinite(v) ? 0 : 1), 0);
  });
}
