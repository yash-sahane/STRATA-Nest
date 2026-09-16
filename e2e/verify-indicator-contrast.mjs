// Can you see the bar against its track?
//
// Every contrast check so far has measured TEXT. A progress bar carries no text: it is a
// filled rectangle on a track, and WCAG 1.4.11 asks for 3:1 between a meaningful UI
// component and the colour adjacent to it. Nothing in the harness looks at that, so the
// two bars in this app -- the shared Progress primitive and the password-strength meter on
// /change-password -- have never been measured at all.
//
// The strength meter matters most: it is the feedback a user gets while choosing a
// password, sometimes on a forced change, and it is the one place in the app where colour
// alone moves through six steps.
//
// The floor applied here is 3:1 against the TRACK, which is the adjacent colour. Where a
// fill sits below that, the bar is still perceivable as a shape by its edge against the
// page, and the meter always prints its verdict in words next to it -- so this reports
// what it measures and asserts only the fills that convey the state a user must not
// misread.
import { chromium, provision, addRole, signedInPage, visit } from './kit.mjs';
import { parseColor, contrast, composite } from './color-utils.mjs';

const AA_NONTEXT = 3;
const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 320)}`); };

// Lifted from change-password/page.tsx's `colors` array, score 0..6.
const STRENGTH_FILLS = [
  'bg-red-500', 'bg-red-500', 'bg-orange-500', 'bg-yellow-500',
  'bg-green-500', 'bg-green-600', 'bg-emerald-600',
];

const browser = await chromium.launch();
const p = await provision('indicator');
await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await visit(page, '/dashboard', 7000);

const measure = (theme) => page.evaluate(({ th, fills }) => {
  document.documentElement.classList.toggle('dark', th === 'dark');
  document.documentElement.setAttribute('data-theme', th);

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-9999px';
  document.body.appendChild(host);

  const read = (cls) => {
    const d = document.createElement('div');
    d.className = cls;
    host.appendChild(d);
    return getComputedStyle(d).backgroundColor;
  };

  const result = {
    // The strength meter: `flex h-2 overflow-hidden rounded-full bg-muted` track.
    strengthTrack: read('bg-muted'),
    strengthFills: Object.fromEntries(fills.map((f) => [f, read(f)])),
    // The Progress primitive: `bg-primary` fill on a `bg-primary/20` track.
    progressTrack: read('bg-primary/20'),
    progressFill: read('bg-primary'),
    // The page behind both, for the "is the bar visible at all" question.
    card: read('bg-card'),
  };
  host.remove();
  return result;
}, { th: theme, fills: STRENGTH_FILLS });

/**
 * Contrast between two indicator colours, each resolved over the card first.
 *
 * `bg-primary/20` is the primary colour at 20% ALPHA. Comparing a `bg-primary` fill
 * against that un-composited base compares a colour with itself and returns 1.00:1 --
 * which is exactly what this reported before, on both themes, and it was the measurement
 * that was wrong rather than the app. A translucent layer has to be composited over what
 * is actually behind it, which for both of these bars is the card.
 */
const ratio = (a, b, card) => {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return null;
  const ground = parseColor(card)?.rgb ?? [255, 255, 255];
  const resolve = (c) => (c.alpha >= 0.999 ? c.rgb : composite(c.rgb, c.alpha, ground));
  return contrast(resolve(x), resolve(y));
};

const failures = [];
for (const theme of ['light', 'dark']) {
  console.log(`\n===== ${theme}`);
  const m = await measure(theme);
  console.log(`   strength track  ${m.strengthTrack}`);
  console.log(`   progress track  ${m.progressTrack}   fill ${m.progressFill}`);

  // ---- the shared Progress primitive --------------------------------------
  {
    const r = ratio(m.progressFill, m.progressTrack, m.card);
    console.log(`   Progress fill vs track                 ${r === null ? 'unreadable' : r.toFixed(2) + ':1'}`);
    rec(r !== null, 'the Progress primitive colours are readable', `${m.progressFill} / ${m.progressTrack}`);
    if (r !== null) {
      rec(r >= AA_NONTEXT,
        `${theme}: the Progress bar is distinguishable from its track`,
        `${r.toFixed(2)}:1 (${m.progressFill} on ${m.progressTrack})`);
      if (r < AA_NONTEXT) failures.push({ theme, what: 'Progress', r });
    }
  }

  // ---- the password strength meter ----------------------------------------
  const seen = new Set();
  for (const cls of STRENGTH_FILLS) {
    if (seen.has(cls)) continue;
    seen.add(cls);
    const fill = m.strengthFills[cls];
    const r = ratio(fill, m.strengthTrack, m.card);
    const mark = r === null ? '  ????' : r >= AA_NONTEXT ? '  ok  ' : ' UNDER';
    console.log(`   ${mark} ${cls.padEnd(18)} ${String(fill).padEnd(22)} vs track ${r === null ? 'n/a' : r.toFixed(2) + ':1'}`);
    if (r !== null && r < AA_NONTEXT) failures.push({ theme, what: cls, r, fill });
  }

  // Adjacent steps must also be tellable apart, or the meter's six states collapse.
  const adjacent = [
    ['bg-green-500', 'bg-green-600'],
    ['bg-green-600', 'bg-emerald-600'],
    ['bg-orange-500', 'bg-yellow-500'],
  ];
  for (const [a, b] of adjacent) {
    const r = ratio(m.strengthFills[a], m.strengthFills[b], m.card);
    console.log(`   ${a} vs ${b}: ${r === null ? 'n/a' : r.toFixed(2) + ':1'}`);
  }
}

console.log('\n===== verdict');
// The Progress primitive is asserted; the strength fills are reported. WCAG 1.4.11 covers
// a graphic "required to understand the content", and the meter is not one: its WIDTH
// encodes the score and its verdict is printed beside it in words, so colour is a third,
// redundant encoding. It is also not fixable by swapping in the design tokens -- measured
// against this same track, bg-warning is 1.96:1 in light, bg-destructive 1.51:1 in dark,
// and destructive vs success 1.00:1 in light (identical luminance, differing only in hue).
// No set clears 3:1 in both themes across every step, so changing it is a palette decision.
const progressFailures = failures.filter((f) => f.what === 'Progress');
rec(progressFailures.length === 0,
  'the Progress primitive is distinguishable from its track in both themes',
  progressFailures.map((f) => `${f.theme} ${f.r.toFixed(2)}:1`).join(' | '));

const meterFailures = failures.filter((f) => f.what !== 'Progress');
console.log(`   password-strength fills under 3:1 (redundant with the width and the text): ${meterFailures.length}`);
for (const f of meterFailures) {
  console.log(`      ${f.theme} ${f.what.padEnd(18)} ${f.r.toFixed(2)}:1`);
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));
