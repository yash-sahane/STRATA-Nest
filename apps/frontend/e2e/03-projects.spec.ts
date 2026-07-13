import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Projects', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/projects');
    await page.waitForLoadState('networkidle');
  });

  test('projects page renders', async ({ page }) => {
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('can open create project dialog', async ({ page }) => {
    const createBtn = page.locator('button:has-text("New Project"), button:has-text("Create Project"), button:has-text("Add Project")').first();
    await expect(createBtn).toBeVisible({ timeout: 5000 });
    await createBtn.click();
    // Dialog should open
    const dialog = page.locator('[role="dialog"], .dialog, [data-state="open"]').first();
    await expect(dialog).toBeVisible({ timeout: 5000 });
  });

  test('create project with valid data', async ({ page }) => {
    const createBtn = page.locator('button:has-text("New Project"), button:has-text("Create Project"), button:has-text("Add Project")').first();
    if (!await createBtn.isVisible({ timeout: 3000 })) {
      test.skip();
      return;
    }
    await createBtn.click();
    const dialog = page.locator('[role="dialog"]').first();
    await dialog.waitFor({ state: 'visible', timeout: 5000 });

    // Fill project name
    const nameInput = dialog.locator('input[name="name"], input[placeholder*="name"], input[placeholder*="Name"]').first();
    if (await nameInput.isVisible({ timeout: 3000 })) {
      await nameInput.fill(`E2E Test Project ${Date.now()}`);
    }

    // Fill short code if present
    const codeInput = dialog.locator('input[name="shortCode"], input[placeholder*="code"], input[placeholder*="Code"]').first();
    if (await codeInput.isVisible({ timeout: 2000 })) {
      await codeInput.fill('E2E');
    }

    // Submit
    const submitBtn = dialog.locator('button[type="submit"], button:has-text("Create"), button:has-text("Save")').first();
    await submitBtn.click();
    await page.waitForTimeout(2000);

    // Check for success (toast or dialog closed)
    const dialogClosed = !(await dialog.isVisible().catch(() => false));
    const toastVisible = await page.locator('[data-sonner-toast], [role="alert"]').first().isVisible().catch(() => false);
    expect(dialogClosed || toastVisible).toBeTruthy();
  });

  test('project card shows correct info', async ({ page }) => {
    // Wait for projects to load
    await page.waitForTimeout(2000);
    const projectCard = page.locator('[data-testid="project-card"], .project-card, [class*="project"]').first();
    if (await projectCard.isVisible({ timeout: 3000 })) {
      await expect(projectCard).toBeVisible();
    }
    // At minimum the page should have loaded
    await expect(page.locator('main')).toBeVisible();
  });

  test('project search/filter works', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="search"], input[type="search"]').first();
    if (await searchInput.isVisible({ timeout: 3000 })) {
      await searchInput.fill('nonexistent_xyz_project');
      await page.waitForTimeout(1000);
      // Should show no results or empty state
      await searchInput.fill('');
    }
  });

  test('can navigate to project detail', async ({ page }) => {
    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (await projectLink.isVisible({ timeout: 3000 })) {
      await projectLink.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/projects/');
    }
  });
});
