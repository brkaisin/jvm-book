import { expect, test } from '@playwright/test';
import { enter, watchErrors } from './helpers';

test.describe('Code Lab', () => {
  test.beforeEach(async ({ page }) => {
    await enter(page);
    await page.keyboard.press('c');
    await expect(page.locator('#lab')).toHaveClass(/open/);
  });

  test('steps through bytecode on the operand stack', async ({ page }) => {
    await page.locator('.chip-btn', { hasText: 'A stack machine' }).click();
    const step = page.locator('.toolbar button', { hasText: 'Step' });
    await step.click(); // bipush 6
    await expect(page.locator('.opstack li').first()).toHaveText('6');
    await step.click(); // istore_1
    await expect(page.locator('.locals')).toContainText('6');
    await expect(page.locator('.bytecode li.cur')).toContainText('bipush 7');
  });

  test('runs a recursive program and prints its result', async ({ page }) => {
    const errors = watchErrors(page);
    await page.locator('.chip-btn', { hasText: 'Recursion' }).click();
    await page.locator('.speed input').fill('8');
    await page.locator('.toolbar .primary').click();
    await expect(page.locator('.console')).toContainText('fib(15) = 610', { timeout: 30_000 });
    await expect(page.locator('.lab-status .state')).toHaveText('finished');
    expect(errors).toEqual([]);
  });

  test('a runaway recursion ends in a StackOverflowError', async ({ page }) => {
    await page.locator('.chip-btn', { hasText: 'StackOverflowError' }).click();
    await page.locator('.speed input').fill('8');
    await page.locator('.toolbar .primary').click();
    await expect(page.locator('.console')).toContainText('StackOverflowError', { timeout: 30_000 });
    await expect(page.locator('#feed')).toContainText('StackOverflowError');
  });

  test('your own code: compile errors point at the line', async ({ page }) => {
    const editor = page.locator('#lab textarea');
    await editor.fill('class Main {\n  public static void main(String[] args) {\n    int x = y + 1;\n  }\n}');
    await page.locator('.toolbar .primary').click();
    await expect(page.locator('.errors li').first()).toContainText('Line 3');
  });

  test('your own code runs, and typing does not trigger shortcuts', async ({ page }) => {
    const editor = page.locator('#lab textarea');
    await editor.fill('');
    await editor.pressSequentially('class Main { public static void main(String[] args) { System.out.println("gc " + 6 * 7); } }');
    await expect(page.locator('#banner')).not.toHaveClass('stw');
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.console')).toContainText('gc 42', { timeout: 20_000 });
  });
});
