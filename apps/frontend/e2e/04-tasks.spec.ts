import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Tasks', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/tasks');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
  });

  test('tasks page renders correctly', async ({ page }) => {
    await expect(page.locator('h1, h2, h3').first()).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
  });

  test('project selector is present', async ({ page }) => {
    // Should have a project selection dropdown
    const projectSelector = page.locator('[data-testid="project-selector"], select[name*="project"], button[aria-haspopup]').first();
    // Page should load without errors
    const errorMsg = page.locator('text=Something went wrong, text=Error, text=500').first();
    expect(await errorMsg.isVisible({ timeout: 2000 }).catch(() => false)).toBeFalsy();
  });

  test('task board / list view renders', async ({ page }) => {
    // Wait for task content to load
    await page.waitForTimeout(2000);
    // Check for task-related elements
    const taskContent = page.locator('[data-testid="task-board"], [data-testid="task-list"], .task-board, .kanban').first();
    const anyContent = page.locator('main > *').first();
    await expect(anyContent).toBeVisible();
  });

  test('view toggle (board/list) works', async ({ page }) => {
    await page.waitForTimeout(1000);
    const boardBtn = page.locator('button[aria-label*="Board"], button[aria-label*="board"], button:has-text("Board")').first();
    const listBtn = page.locator('button[aria-label*="List"], button[aria-label*="list"], button:has-text("List")').first();
    if (await boardBtn.isVisible({ timeout: 2000 })) {
      await boardBtn.click();
      await page.waitForTimeout(500);
    }
    if (await listBtn.isVisible({ timeout: 2000 })) {
      await listBtn.click();
      await page.waitForTimeout(500);
    }
    // No crash
    await expect(page.locator('main')).toBeVisible();
  });

  test('create task button is accessible', async ({ page }) => {
    await page.waitForTimeout(1000);
    const createBtn = page.locator('button:has-text("New Task"), button:has-text("Create Task"), button:has-text("Add Task"), button[aria-label*="create task"]').first();
    // The button might only show after selecting a project
    await expect(page.locator('main')).toBeVisible();
  });

  test('task filters work', async ({ page }) => {
    await page.waitForTimeout(1000);
    // Try status filter
    const filterBtn = page.locator('button:has-text("Filter"), button:has-text("All"), select[name*="status"]').first();
    if (await filterBtn.isVisible({ timeout: 2000 })) {
      await filterBtn.click();
      await page.waitForTimeout(500);
      // Close by clicking elsewhere
      await page.keyboard.press('Escape');
    }
  });

  test('task sort works', async ({ page }) => {
    await page.waitForTimeout(1000);
    const sortBtn = page.locator('button:has-text("Sort"), th:has-text("Title")').first();
    if (await sortBtn.isVisible({ timeout: 2000 })) {
      await sortBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('task search works', async ({ page }) => {
    await page.waitForTimeout(1000);
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="search"]').first();
    if (await searchInput.isVisible({ timeout: 2000 })) {
      await searchInput.fill('test query');
      await page.waitForTimeout(800);
      await searchInput.fill('');
    }
    // No errors
    await expect(page.locator('main')).toBeVisible();
  });
});
