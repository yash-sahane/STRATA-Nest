import { Page, expect } from '@playwright/test';

export const TEST_USER = {
  email: 'admin@test.com',
  password: 'admin123',
  name: 'Test Admin',
};

export async function login(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"], input[name="email"]', TEST_USER.email);
  await page.fill('input[type="password"], input[name="password"]', TEST_USER.password);
  await page.click('button[type="submit"]');
  // Wait for redirect to dashboard or onboarding
  await page.waitForURL(/\/(dashboard|onboarding|tasks|projects)/, { timeout: 15000 });
}

export async function ensureOnDashboard(page: Page) {
  const url = page.url();
  if (url.includes('/login') || url === 'http://localhost:3000/') {
    await login(page);
  }
}

export async function selectWorkspace(page: Page) {
  // Wait for workspace context to load
  await page.waitForTimeout(1000);
  const workspaceSelector = page.locator('[data-testid="workspace-selector"], [aria-label="workspace"]').first();
  if (await workspaceSelector.isVisible()) {
    await workspaceSelector.click();
    await page.waitForTimeout(500);
  }
}

export async function waitForToast(page: Page, text?: string) {
  const toast = page.locator('[data-sonner-toast], [role="alert"], .toast').first();
  await toast.waitFor({ state: 'visible', timeout: 8000 });
  if (text) {
    await expect(toast).toContainText(text, { timeout: 5000 });
  }
  return toast;
}

export async function dismissToast(page: Page) {
  const toast = page.locator('[data-sonner-toast], [role="alert"]').first();
  if (await toast.isVisible()) {
    await toast.click();
    await page.waitForTimeout(300);
  }
}

export async function getWorkspaceId(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  // Try to extract workspace ID from URL or localStorage
  const url = page.url();
  const match = url.match(/workspaceId=([^&]+)/);
  if (match) return match[1];
  return '';
}
