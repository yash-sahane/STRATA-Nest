// The app's DatePicker (apps/frontend/src/components/ui/date-picker.tsx, on
// react-day-picker 8) driven the way a person drives it: open it, page to the
// month, click the day. The leave form, the team attendance day and the epic
// dialogs use it instead of the browser's own date input, which a script could
// simply type into.
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The open calendar's month, as [year, month 1-12]. */
async function shownMonth(popover) {
  const caption = (await popover.locator('[aria-live="polite"]').first().innerText()).trim();
  const [name, year] = caption.split(/\s+/);
  return [Number(year), MONTHS.indexOf(name) + 1];
}

/**
 * With a picker open: page to the month of `iso` ('YYYY-MM-DD') and return that
 * day's button — the month's own, not a neighbouring month's spill-over day.
 */
export async function dayButton(page, iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const popover = page.locator('[data-radix-popper-content-wrapper]').last();
  await popover.locator('[role="grid"]').first().waitFor({ state: 'visible', timeout: 5000 });
  for (let i = 0; i < 60; i += 1) {
    const [shownYear, shownMonthNo] = await shownMonth(popover);
    if (shownYear === y && shownMonthNo === m) break;
    const forward = shownYear < y || (shownYear === y && shownMonthNo < m);
    await popover.getByRole('button', { name: forward ? /next month/i : /previous month/i }).click();
  }
  return popover
    .locator('button[name="day"]:not(.day-outside)')
    .filter({ hasText: new RegExp(`^${d}$`) })
    .first();
}

/** Open the picker behind `trigger` and choose `iso`; it closes on the choice. */
export async function pickDate(page, trigger, iso) {
  await trigger.click();
  await (await dayButton(page, iso)).click();
  // The field says what was chosen (DatePicker writes it to data-value).
  await page.waitForFunction(
    ([id, value]) => document.getElementById(id)?.getAttribute('data-value') === value,
    [await trigger.getAttribute('id'), iso],
    { timeout: 3000 },
  ).catch(() => undefined);
}

/** Open the picker behind `trigger`, let `look` read it, and close it again. */
export async function inPicker(page, trigger, look) {
  await trigger.click();
  try {
    return await look();
  } finally {
    await page.keyboard.press('Escape');
  }
}
