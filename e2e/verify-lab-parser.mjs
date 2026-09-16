// Do the lab() and oklab() parsers agree with the browser?
//
// The contrast sweep silently skipped every `lab()` colour -- Tailwind v4's whole default
// palette -- because parseColor returned null and judge turned null into "nothing to
// report". Now that lab() is parsed, the arithmetic has to be checked against something
// other than itself: a wrong converter would turn a silent blind spot into confident
// wrong numbers, which is worse.
//
// Ground truth is the browser. A canvas fillStyle accepts `lab(...)` and getImageData
// returns the sRGB bytes Chrome actually painted, so each conversion is compared against
// the pixel the user would really see. The cases are the real palette values read off the
// app's own stylesheet, not values chosen to suit the converter.
import { chromium } from './kit.mjs';
import { parseColor, contrast } from './color-utils.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 300)}`); };

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto('about:blank');

// Every distinct lab() in the built stylesheet would be ideal; these are the ones the
// status vocabularies actually use, plus the extremes and a mid grey.
const CASES = [
  'lab(100 0 0)',
  'lab(0 0 0)',
  'lab(50 0 0)',
  'lab(94.3433 -5.00426 52.9663)',
  'lab(16.8146 15.7422 23.1133)',
  'lab(92.4222 -26.4702 12.9427)',
  'lab(15.6845 -20.4225 11.7249)',
  'lab(86.017 19.8815 7.75869)',
  'lab(13.003 29.04 16.7519)',
  'lab(91.6229 -0.159085 -2.26791)',
  'lab(1.90334 0.278696 -5.48866)',
  'lab(30.797 -29.6927 17.382)',
  'lab(28.5139 44.5539 29.0463)',
  'lab(43.6 12.6 55)',
  'lab(66.2 -13.8 -42.5)',
  // oklab, which Tailwind v4's alpha modifier (`bg-primary/20`) resolves to. It never
  // appears in the built stylesheet, so it is only reachable by measuring a computed
  // value -- which is exactly how it was missed until the indicator check hit it.
  'oklab(1 0 0)',
  'oklab(0 0 0)',
  'oklab(0.5 0 0)',
  'oklab(0.984799 0.0000446141 0.0000197291)',
  'oklab(0.627955 0.224863 0.125846)',
  'oklab(0.8664 -0.2339 0.1794)',
];

const truth = await page.evaluate((cases) => {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  // A plain sRGB context, so the bytes read back are sRGB bytes.
  const g = canvas.getContext('2d', { colorSpace: 'srgb' });
  const result = {};
  for (const css of cases) {
    g.clearRect(0, 0, 4, 4);
    g.fillStyle = '#000000';
    g.fillStyle = css;            // ignored if unsupported, leaving the previous value
    const applied = g.fillStyle;
    g.fillRect(0, 0, 4, 4);
    const d = g.getImageData(1, 1, 1, 1).data;
    result[css] = { rgb: [d[0], d[1], d[2]], applied };
  }
  return result;
}, CASES);

let worst = 0;
let worstCase = null;
for (const css of CASES) {
  const t = truth[css];
  const mine = parseColor(css);
  if (!mine) {
    rec(false, `parsed ${css}`, 'parseColor returned null');
    continue;
  }
  // If fillStyle refused the value it stays '#000000' and the comparison is meaningless.
  const accepted = t.applied !== '#000000' || css === 'lab(0 0 0)';
  if (!accepted) {
    rec(false, `the browser accepts ${css} as a fillStyle, so it is ground truth`,
      `fillStyle read back as ${t.applied}`);
    continue;
  }
  const diff = Math.max(...mine.rgb.map((v, i) => Math.abs(v - t.rgb[i])));
  if (diff > worst) { worst = diff; worstCase = css; }
  console.log(`   ${css.padEnd(32)} mine rgb(${mine.rgb.join(', ')})`.padEnd(76)
    + ` browser rgb(${t.rgb.join(', ')})  max delta ${diff}`);
  // 2/255 allows for the browser's own rounding without allowing a real error.
  rec(diff <= 2, `${css} converts to what the browser paints`,
    `mine rgb(${mine.rgb.join(', ')}) vs browser rgb(${t.rgb.join(', ')}), delta ${diff}`);
}

console.log(`\n   worst channel delta across ${CASES.length} cases: ${worst}${worstCase ? ` (${worstCase})` : ''}`);

// And the thing the parser exists for: a contrast ratio that agrees end to end.
{
  const fg = parseColor('lab(43.6 12.6 55)');
  const bg = parseColor('lab(94.3433 -5.00426 52.9663)');
  const mineRatio = contrast(fg.rgb, bg.rgb);
  const browserRatio = contrast(truth['lab(43.6 12.6 55)'].rgb, truth['lab(94.3433 -5.00426 52.9663)'].rgb);
  console.log(`   contrast from my rgb ${mineRatio.toFixed(3)}:1  from the browser's ${browserRatio.toFixed(3)}:1`);
  rec(Math.abs(mineRatio - browserRatio) < 0.05,
    'a contrast ratio computed from parsed lab matches one computed from the painted pixels',
    `${mineRatio.toFixed(3)} vs ${browserRatio.toFixed(3)}`);
}

await browser.close();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));
