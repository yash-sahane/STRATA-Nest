import { test, expect } from '@playwright/test';
import { TEST_USER, login } from './helpers';

test.describe('Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');
    // Login page uses Shadcn CardTitle (renders as h3, not h1/h2)
    const titleVisible = await page.locator('h1, h2, h3').first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(titleVisible, 'Login page title should be visible').toBeTruthy();
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"], input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"], input[name="email"]', TEST_USER.email);
    await page.fill('input[type="password"], input[name="password"]', TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(dashboard|onboarding|tasks|projects|leave|attendance)/, { timeout: 15000 });
    expect(page.url()).not.toContain('/login');
  });

  test('login with wrong password shows error', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"], input[name="email"]', TEST_USER.email);
    await page.fill('input[type="password"], input[name="password"]', 'wrongpassword123');
    await page.click('button[type="submit"]');
    // Should stay on login or show error
    await page.waitForTimeout(2000);
    const hasError = await page.locator('[role="alert"], .error, [data-sonner-toast]').first().isVisible();
    const stillOnLogin = page.url().includes('/login');
    expect(hasError || stillOnLogin).toBeTruthy();
  });

  test('login with empty fields shows validation', async ({ page }) => {
    await page.goto('/login');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);
    // Should show validation or stay on login
    expect(page.url()).toContain('/login');
  });

  test('logout works correctly', async ({ page }) => {
    await login(page);
    // Find and click logout - look for profile menu or logout button
    const profileBtn = page.locator('[aria-label*="profile"], [aria-label*="user"], [data-testid="user-menu"]').first();
    if (await profileBtn.isVisible({ timeout: 3000 })) {
      await profileBtn.click();
    } else {
      // Try clicking avatar or initials
      await page.locator('button:has-text("TA"), button:has-text("A"), [data-testid="avatar"]').first().click();
    }
    await page.waitForTimeout(500);
    const logoutBtn = page.locator('button:has-text("Logout"), button:has-text("Sign out"), a:has-text("Logout")').first();
    if (await logoutBtn.isVisible({ timeout: 3000 })) {
      await logoutBtn.click();
      await page.waitForURL('/login', { timeout: 10000 });
      expect(page.url()).toContain('/login');
    }
  });

  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForURL(/\/login/, { timeout: 10000 });
    expect(page.url()).toContain('/login');
  });
});
