// Can you see how full the password strength bar is, and does it agree with the words?
//
// Two separate defects lived here.
//
// THE BAR. The fill sits directly on `bg-muted` with nothing between them, and the shades
// were picked for one theme. `bg-yellow-500` measured 1.75:1 against the light track — at
// "Fair", the step somebody is most likely to be sitting on while deciding whether to keep
// typing, the filled part was very nearly indistinguishable from the empty part. 3:1 is
// the WCAG 1.4.11 floor for a graphic that carries meaning.
//
// THE WORDS. The colour came from a seven-entry array and the label from a separate ladder
// of thresholds, and the two did not line up: at score 4 the bar was already green while
// the label read "Fair". The two greens either side of that ("Fair" green-500 and "Good"
// green-600) measured 1.13:1 apart, which is no distinction at all.
//
// Driven through the real form, on the real page, with the real transition allowed to
// settle — reading a `transition-colors` element in the same tick as the change captures
// an interpolated frame, which is how an earlier probe reported the dark palette applying
// in light theme.
import { chromium, provision, addRole, signedInPage, visit, recorder } from './kit.mjs';
import { parseColor, contrast } from './color-utils.mjs';

const { rec, summary } = recorder();

// [password, the band it should land in]. The score is
// (len>=8) + (len>=12) + lower + upper + digit + symbol, so these walk it 2 -> 6.
const CASES = [
  ['abcdefgh', 'Weak'],
  ['abcdefghA', 'Fair'],
  ['abcdefghA1', 'Fair'],
  ['abcdefghA1!', 'Good'],
  ['abcdefghijA1!', 'Excellent'],
];

const browser = await chromium.launch();
const p = await provision('strength');
await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await visit(page, '/change-password', 8000);

const newPassword = page.locator('#newPassword, input[name="newPassword"]').first();
const haveField = (await newPassword.count()) > 0;
rec(haveField, 'the change-password form is on screen', `found ${await newPassword.count()} fields`);

if (haveField) {
  const setTheme = async (theme) => {
    await page.evaluate((th) => {
      document.documentElement.classList.toggle('dark', th === 'dark');
      document.documentElement.setAttribute('data-theme', th);
    }, theme);
    // The bar carries `transition-all`; read it too early and the value is a frame from
    // the middle of the animation rather than the colour it lands on.
    await page.waitForTimeout(900);
  };

  /** The bar's fill and its track, as painted. */
  const readBar = () =>
    page.evaluate(() => {
      const track = [...document.querySelectorAll('div')].find(
        (d) => d.className.includes('rounded-full') && d.className.includes('bg-muted'),
      );
      if (!track) return null;
      const fill = track.firstElementChild;
      if (!fill) return null;
      const feedback = track.parentElement?.querySelector('p');
      return {
        fill: getComputedStyle(fill).backgroundColor,
        track: getComputedStyle(track).backgroundColor,
        width: fill.getBoundingClientRect().width,
        trackWidth: track.getBoundingClientRect().width,
        feedback: (feedback?.textContent || '').trim(),
        live: feedback?.getAttribute('aria-live') || '',
        barHidden: track.getAttribute('aria-hidden') === 'true',
      };
    });

  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    console.log(`\n===== ${theme}`);
    const seen = new Map();
    let lastWidth = -1;

    for (const [password, expected] of CASES) {
      await newPassword.fill(password);
      await page.waitForTimeout(900);
      const bar = await readBar();
      if (!bar) {
        rec(false, `${theme}: the bar is measurable for "${expected}"`, 'no track element found');
        continue;
      }

      rec(
        bar.feedback.startsWith(expected),
        `${theme}: "${password}" is described as ${expected}`,
        `the line reads ${JSON.stringify(bar.feedback)}`,
      );

      const f = parseColor(bar.fill);
      const t = parseColor(bar.track);
      if (!f || !t) {
        rec(
          false,
          `${theme}: the ${expected} fill can be read`,
          `fill=${bar.fill} track=${bar.track} — an unreadable colour is not a pass`,
        );
        continue;
      }
      const ratio = contrast(f.rgb, t.rgb);
      rec(
        ratio >= 3,
        `${theme}: the ${expected} fill is distinguishable from the track`,
        `${ratio.toFixed(2)}:1 against ${bar.track} — under 3:1 the bar shows nothing`,
      );
      console.log(`   ${expected.padEnd(10)} ${ratio.toFixed(2)}:1   width ${Math.round(bar.width)}/${Math.round(bar.trackWidth)}`);

      // A stronger password must never show a shorter bar.
      rec(
        bar.width >= lastWidth,
        `${theme}: the bar does not shrink as the password gets stronger`,
        `${Math.round(bar.width)}px after ${Math.round(lastWidth)}px`,
      );
      lastWidth = bar.width;

      if (!seen.has(expected)) seen.set(expected, bar.fill);
    }

    // Weak, Fair and Good must not be the same colour — that is the mismatch this
    // replaced, where two adjacent bands were both green and 1.13:1 apart.
    const weak = seen.get('Weak');
    const fair = seen.get('Fair');
    const good = seen.get('Good');
    rec(
      weak && fair && weak !== fair,
      `${theme}: Weak and Fair are different colours`,
      `${weak} vs ${fair}`,
    );
    rec(
      fair && good && fair !== good,
      `${theme}: Fair and Good are different colours`,
      `${fair} vs ${good}`,
    );
  }

  // The bar is decoration; the sentence under it is the content.
  const bar = await readBar();
  rec(
    bar?.live === 'polite',
    'the strength is announced when it changes',
    `aria-live=${JSON.stringify(bar?.live)} — without it the only non-visual form of this ` +
      'information changes in silence',
  );
  rec(
    bar?.barHidden === true,
    'and is not announced twice',
    'the bar should be aria-hidden, since the line underneath says the same thing',
  );
}

const rows = summary();
await ctx.close();
await browser.close();
await p.cleanup();
process.exitCode = rows.some((r) => !r.ok) ? 1 : 0;
