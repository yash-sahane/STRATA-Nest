import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Sprints', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/sprints');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
  });

  test('sprints page renders', async ({ page }) => {
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('can open create sprint dialog', async ({ page }) => {
    const createBtn = page.locator('button:has-text("New Sprint"), button:has-text("Create Sprint"), button:has-text("Add Sprint")').first();
    if (await createBtn.isVisible({ timeout: 3000 })) {
      await createBtn.click();
      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape');
    }
  });

  test('sprint list loads without error', async ({ page }) => {
    await page.waitForTimeout(2000);
    const errorMsg = page.locator('text=Something went wrong, text=Error loading').first();
    expect(await errorMsg.isVisible({ timeout: 1000 }).catch(() => false)).toBeFalsy();
    await expect(page.locator('main')).toBeVisible();
  });

  test('sprint detail page accessible', async ({ page }) => {
    await page.waitForTimeout(2000);
    const sprintLink = page.locator('a[href*="/sprints/"]').first();
    if (await sprintLink.isVisible({ timeout: 3000 })) {
      await sprintLink.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/sprints/');
    }
  });
});
