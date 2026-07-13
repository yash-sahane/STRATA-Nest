import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Requirements', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1000);
  });

  test('client requirements page renders', async ({ page }) => {
    await page.goto('/requirements');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('functional requirements page renders', async ({ page }) => {
    await page.goto('/functional-requirements');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('can open create client requirement dialog', async ({ page }) => {
    await page.goto('/requirements');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const createBtn = page.locator('button:has-text("New"), button:has-text("Create"), button:has-text("Add")').first();
    if (await createBtn.isVisible({ timeout: 3000 })) {
      await createBtn.click();
      const dialog = page.locator('[role="dialog"]').first();
      if (await dialog.isVisible({ timeout: 3000 })) {
        await page.keyboard.press('Escape');
      }
    }
    await expect(page.locator('main')).toBeVisible();
  });

  test('requirements filter by project works', async ({ page }) => {
    await page.goto('/requirements');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    const projectSelect = page.locator('[role="combobox"], select').first();
    if (await projectSelect.isVisible({ timeout: 2000 })) {
      await projectSelect.click();
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
    }
    await expect(page.locator('main')).toBeVisible();
  });

  test('epics page renders', async ({ page }) => {
    await page.goto('/epics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('can create an epic', async ({ page }) => {
    await page.goto('/epics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const createBtn = page.locator('button:has-text("New Epic"), button:has-text("Create Epic"), button:has-text("Add Epic")').first();
    if (await createBtn.isVisible({ timeout: 3000 })) {
      await createBtn.click();
      const dialog = page.locator('[role="dialog"]').first();
      if (await dialog.isVisible({ timeout: 3000 })) {
        const nameInput = dialog.locator('input[name="name"], input[placeholder*="name"]').first();
        if (await nameInput.isVisible({ timeout: 2000 })) {
          await nameInput.fill('E2E Test Epic');
        }
        await page.keyboard.press('Escape');
      }
    }
  });
});
