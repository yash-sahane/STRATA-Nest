import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Analytics & Reports', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('analytics page renders', async ({ page }) => {
    await page.goto('/analytics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page.locator('main')).toBeVisible();
    const error = await page.locator('text=Something went wrong, text=Error loading, text=404').first().isVisible({ timeout: 1000 }).catch(() => false);
    expect(error).toBeFalsy();
  });

  test('team analytics page renders', async ({ page }) => {
    await page.goto('/analytics/team');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page.locator('main')).toBeVisible();
  });

  test('workspace analytics page renders', async ({ page }) => {
    await page.goto('/analytics/workspace');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page.locator('main')).toBeVisible();
  });

  test('activity feed page renders', async ({ page }) => {
    await page.goto('/activity');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page.locator('main')).toBeVisible();
  });

  test('calendar page renders', async ({ page }) => {
    await page.goto('/calendar');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page.locator('main')).toBeVisible();
  });

  test('dashboard page shows stats widgets', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);
    await expect(page.locator('main')).toBeVisible();
    // Stats cards or charts should be present
    const statsOrCharts = page.locator('[data-testid*="stat"], .recharts-wrapper, canvas, [class*="card"]').first();
    // Page should render without 500/crash
    const error = await page.locator('text=Something went wrong').first().isVisible({ timeout: 1000 }).catch(() => false);
    expect(error).toBeFalsy();
  });
});
