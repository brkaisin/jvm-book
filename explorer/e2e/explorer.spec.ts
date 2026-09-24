import { expect, test } from '@playwright/test';
import { AREAS, HOTSPOTS, TOUR, type AreaId, type HotspotId } from '../src/content';
import { enter, nonFinitePixels, watchErrors } from './helpers';

test('the intro invites you in, then the world comes alive', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/index.html');
  await expect(page.locator('#intro h1')).toContainText('Enter the');
  await page.click('#enter');
  await expect(page.locator('#hud dd').first()).toContainText('regions');
  await expect(page.locator('.lbl.major').first()).toBeVisible();
  expect(errors).toEqual([]);
});

for (const area of Object.keys(AREAS) as AreaId[]) {
  test(`every ${AREAS[area].label.toLowerCase()} hotspot opens its panel and renders cleanly`, async ({ page }) => {
    const errors = watchErrors(page);
    await enter(page);
    const ids = (Object.keys(HOTSPOTS) as HotspotId[]).filter((id) => HOTSPOTS[id].area === area);
    for (const id of ids) {
      await page.evaluate((id) => (location.hash = id), id);
      await expect(page.locator('#panel h2')).toHaveText(HOTSPOTS[id].title);
      await expect(page.locator('#panel .see')).toBeVisible();
      await page.waitForTimeout(700);
      expect(await nonFinitePixels(page), `NaN pixels at #${id}`).toBe(0);
    }
    expect(errors).toEqual([]);
  });
}

test('the guided tour goes from start to finish', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/index.html');
  await page.click('#enter-tour');
  for (let i = 0; i < TOUR.length; i++) {
    await expect(page.locator('#tour .count')).toHaveText(`${i + 1} / ${TOUR.length}`);
    await expect(page.locator('#panel h2')).toHaveText(HOTSPOTS[TOUR[i].id].title);
    await page.keyboard.press('ArrowRight');
  }
  await expect(page.locator('#tour')).not.toHaveClass(/open/);
  expect(errors).toEqual([]);
});

test('G1 stops the world, ZGC does not', async ({ page }) => {
  await enter(page);
  await page.keyboard.press('g');
  await expect(page.locator('#banner')).toHaveClass('stw', { timeout: 5000 });
  await expect(page.locator('#feed')).toContainText('Pause Young', { timeout: 10000 });
  await page.keyboard.press('z');
  await expect(page.locator('#c-gc')).toHaveText('ZGC');
  await page.keyboard.press('g');
  await expect(page.locator('#banner')).toHaveClass('concurrent', { timeout: 5000 });
  await expect(page.locator('#feed')).toContainText('ZGC', { timeout: 10000 });
});

test('clicking a heap object links it to its class', async ({ page }) => {
  await enter(page, '#object');
  await expect(page.locator('#panel .live')).toContainText('Class', { timeout: 10000 });
  await expect(page.locator('#panel .live')).toContainText('bytes');
});

test('the legend explains the colours and leads to hotspots', async ({ page }) => {
  await enter(page);
  await page.keyboard.press('k');
  await expect(page.locator('#legend')).toHaveClass(/open/);
  await page.locator('#legend button', { hasText: 'Survivor' }).click();
  await expect(page.locator('#legend')).not.toHaveClass(/open/);
  await expect(page.locator('#panel h2')).toHaveText(HOTSPOTS.survivor.title);
});

test('a first-time event gets explained', async ({ page }) => {
  await enter(page);
  await expect(page.locator('#moment')).toHaveClass(/open/, { timeout: 20000 });
  await page.locator('#moment button', { hasText: 'Show me' }).click();
  await expect(page.locator('#panel')).toHaveClass(/open/);
});

test('hovering a thing explains what it is and what a click does', async ({ page }) => {
  await enter(page, '#heap');
  await page.waitForTimeout(2500);
  const at = await page.evaluate(() => {
    const { world, regionCenter, screenOf } = (window as any).__jvm;
    const free = world.sim.heap.regions.find((r: { role: string }) => r.role === 'free');
    return screenOf(regionCenter(free.index));
  });
  await page.mouse.move(at.x, at.y);
  await expect(page.locator('#tip')).toBeVisible();
  await expect(page.locator('#tip i')).toHaveText(/^Click: allocate 150 objects$/);
});

test('the embed mode shows only the scene and a call to action', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/index.html?embed');
  await expect(page.locator('#embed-cta')).toBeVisible();
  await expect(page.locator('#intro')).toBeHidden();
  await expect(page.locator('#controls')).toBeHidden();
  expect(errors).toEqual([]);
});
