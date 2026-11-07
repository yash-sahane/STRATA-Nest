// Measure the REAL rendered contrast of destructive text in both themes, the
// same way the finding did: computed colour against the composited ground.
import { chromium, getBrowserCookies, BASE } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  -> ' + d}`); };

const lum = (r, g, b) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(...a), lum(...b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const browser = await chromium.launch();
for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies(await getBrowserCookies('admin@strata.local'));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
  await page.goto(`${BASE}/projects`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);

  // open Create Project and submit empty to force the validation messages
  await page.getByRole('button', { name: /new project/i }).first().click();
  await page.waitForTimeout(1500);
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.getByRole('button', { name: /create project/i }).last().click();
  await page.waitForTimeout(1800);

  const measured = await page.evaluate(() => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const groundOf = (el) => {
      let n = el;
      while (n) {
        const bg = getComputedStyle(n).backgroundColor;
        const p = parse(bg);
        if (p.length === 3 && !/rgba\(0, 0, 0, 0\)/.test(bg)) return p;
        n = n.parentElement;
      }
      return [255, 255, 255];
    };
    const nodes = [...document.querySelectorAll('[role="dialog"] *')].filter(
      (e) => !e.children.length && (e.textContent || '').trim().length > 3
    );
    const reds = nodes
      .map((e) => ({ text: e.textContent.trim().slice(0, 40), fg: parse(getComputedStyle(e).color), bg: groundOf(e) }))
      .filter((x) => x.fg[0] > x.fg[1] + 25 && x.fg[0] > x.fg[2] + 25); // reddish = destructive
    return { reds, htmlClass: document.documentElement.className };
  });

  console.log(`\n--- ${theme} (html="${measured.htmlClass}")`);
  if (!measured.reds.length) { console.log('   no destructive text found on screen'); }
  for (const r of measured.reds.slice(0, 4)) {
    const c = ratio(r.fg, r.bg);
    console.log(`   ${c.toFixed(2)}:1  rgb(${r.fg}) on rgb(${r.bg})  "${r.text}"`);
    rec(c >= 4.5, `${theme}: "${r.text}" clears AA`, `${c.toFixed(2)}:1`);
  }
  await ctx.close();
}
await browser.close();

const bad = out.filter(([ok]) => !ok);
console.log(`\n===== total ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));
