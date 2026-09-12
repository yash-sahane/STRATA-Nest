import { BrowserContext, Page, expect } from '@playwright/test';

/**
 * The account the suite signs in as. These default to the superuser the Prisma
 * seed actually creates (packages/prisma/src/seed.ts) — the previous hard-coded
 * admin@test.com/admin123 existed in no seed, so every test in this suite failed
 * at login on a freshly migrated database. Override via env when pointing the
 * suite at an environment seeded with different credentials.
 */
export const TEST_USER = {
  email: process.env.E2E_EMAIL ?? 'admin@strata.local',
  password: process.env.E2E_PASSWORD ?? 'ChangeMe123!',
  name: 'Admin',
};

/**
 * Cookies from the first successful sign-in, replayed into every later context.
 *
 * This helper runs in `beforeEach` across the suite, so submitting the form each
 * time meant ~70 real logins per run against THROTTLE_LOGIN_LIMIT (5/minute per
 * IP) — the API started answering 429 a few tests in and the rest of the run
 * failed for reasons that had nothing to do with what they were testing. One real
 * login per process, reused after that. The auth spec still drives the form
 * directly where signing in IS the thing under test.
 */
let cachedCookies: Awaited<ReturnType<BrowserContext['cookies']>> | null = null;

async function submitLoginForm(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"], input[name="email"]', TEST_USER.email);
  await page.fill('input[type="password"], input[name="password"]', TEST_USER.password);
  await page.click('button[type="submit"]');
  // Wait for redirect to dashboard or onboarding
  await page.waitForURL(/\/(dashboard|onboarding|tasks|projects)/, { timeout: 15000 });
}

export async function login(page: Page) {
  if (cachedCookies) {
    await page.context().addCookies(cachedCookies);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    if (!page.url().includes('/login')) return;
    cachedCookies = null; // session no longer valid — sign in for real below
  }

  await submitLoginForm(page);
  cachedCookies = await page.context().cookies();
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
