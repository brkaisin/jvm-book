import { expect, test } from '@playwright/test';
import { enter } from './helpers';

test('fits a phone screen', async ({ page }) => {
  await enter(page, '#gc');
  await expect(page.locator('#panel')).toHaveClass(/open/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  const panel = await page.locator('#panel').boundingBox();
  const viewport = page.viewportSize()!;
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width);
});
