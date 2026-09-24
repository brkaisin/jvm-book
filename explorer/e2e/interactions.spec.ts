import { expect, test } from '@playwright/test';
import { HOTSPOTS, type HotspotId } from '../src/content';
import { enter, watchErrors } from './helpers';

// Each element's main action, and what the event feed should then say.
const POKES: [HotspotId, RegExp][] = [
  ['heap', /Allocated \d+ objects/],
  ['classloaders', /Loading/],
  ['threads', /calls 6 methods deeper/],
  ['native', /SSL_read/],
  ['jfr', /JFR\.dump/],
  ['vthreads', /Started \d+ virtual threads/],
  ['interpreter', /is hot|already compiled/],
];

for (const [id, feed] of POKES) {
  test(`${id}: its main action does something visible`, async ({ page }) => {
    const errors = watchErrors(page);
    await enter(page, `#${id}`);
    const primary = page.locator('#panel .act.primary');
    await expect(primary).toContainText(HOTSPOTS[id].poke!.label);
    await primary.click();
    await expect(page.locator('#feed')).toContainText(feed, { timeout: 5000 });
    expect(errors).toEqual([]);
  });
}

test('the garbage collector collects when asked', async ({ page }) => {
  await enter(page, '#gc');
  await page.locator('#panel .act.primary').click();
  await expect(page.locator('#banner')).toHaveClass('stw', { timeout: 5000 });
});

test('clicking a thing in the world opens it and runs its action', async ({ page }) => {
  await enter(page, '#heap');
  await page.waitForTimeout(2500);
  const before = await page.locator('#feed .ev').count();
  // Click right in the middle of a free heap region.
  const at = await page.evaluate(() => {
    const { world, regionCenter, screenOf } = (window as any).__jvm;
    const free = world.sim.heap.regions.find((r: { role: string }) => r.role === 'free');
    return screenOf(regionCenter(free.index));
  });
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('#feed')).toContainText('Allocated');
  expect(await page.locator('#feed .ev').count()).toBeGreaterThan(before);
});

test('sound and narrator can be switched off, and stay off', async ({ page }) => {
  const errors = watchErrors(page);
  await enter(page);
  await page.locator('#c-sound').click();
  await page.locator('#c-narrator').click();
  await expect(page.locator('#c-sound')).not.toHaveClass(/on/);
  await expect(page.locator('#c-narrator')).not.toHaveClass(/on/);
  await page.reload();
  await page.click('#enter');
  await expect(page.locator('#c-sound')).not.toHaveClass(/on/);
  expect(errors).toEqual([]);
});

test('the narrator captions what it explains', async ({ page }) => {
  await enter(page);
  await page.evaluate(() => (location.hash = 'c2'));
  await expect(page.locator('#narrator')).toHaveClass(/open/);
  await expect(page.locator('#narrator .caption')).toContainText('C two');
});
