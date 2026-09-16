// Colour maths for the contrast checks.
//
// Two things trip up a naive checker on this app, and both produced false
// failures before this module existed:
//
//  1. Tailwind v4 defines its tokens in oklch, and getComputedStyle hands those
//     back as `oklch(L C H)`. Reading those three numbers as r,g,b invents
//     colours — it reported 44 failures, of which zero were real.
//  2. An element can be painted by a background-IMAGE (a gradient). Walking
//     backgroundColor sees `transparent` there and measures the text against
//     the page instead of the fill actually behind it. The sidebar avatar reads
//     1.04:1 that way and 12.1:1 in the rendered pixels.

/**
 * oklab -> sRGB 0-255.
 *
 * Tailwind v4's alpha modifier (`bg-primary/20`) compiles to `color-mix(in oklab, ...)`,
 * which the browser resolves to `oklab(L a b / alpha)`. The literal never appears in the
 * stylesheet, so this is only reachable by measuring a computed value.
 */
export function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, c)) * 255);
  });
}

/** oklch -> sRGB 0-255. Polar form of the same space, so it shares the transform. */
export function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, c)) * 255);
  });
}

/** Any computed colour string -> {rgb, alpha}, or null if unrecognised. */
/**
 * CSS `lab()` -> sRGB 0-255.
 *
 * This is where Tailwind v4's default palette lives, and getComputedStyle returns it
 * verbatim rather than normalising to rgb() as it does for hsl(). Without this the whole
 * default palette was unparseable, and an unparseable colour was silently not measured.
 *
 * CSS lab() is D50-referenced, so the chain is CIELAB -> XYZ(D50) -> Bradford-adapted
 * linear sRGB -> gamma. Matrix from the CSS Color 4 sample conversions.
 */
function labToRgb(L, a, bStar) {
  const K = 24389 / 27;
  const E = 216 / 24389;

  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bStar / 200;

  const fx3 = fx ** 3;
  const fz3 = fz ** 3;
  const xr = fx3 > E ? fx3 : (116 * fx - 16) / K;
  const yr = L > K * E ? fy ** 3 : L / K;
  const zr = fz3 > E ? fz3 : (116 * fz - 16) / K;

  // D50 white point, as CSS defines it.
  const X = xr * 0.3457 / 0.3585;
  const Y = yr * 1.0;
  const Z = zr * (1.0 - 0.3457 - 0.3585) / 0.3585;

  // XYZ(D50) -> linear sRGB, Bradford-adapted (combined matrix).
  const lin = [
    3.1341359569958707 * X - 1.6173863321612538 * Y - 0.4906619460083532 * Z,
    -0.978795502912089 * X + 1.9161404439746186 * Y + 0.03344540932750888 * Z,
    0.07195537988411677 * X - 0.2289768264158322 * Y + 1.405386233324288 * Z,
  ];

  return lin.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
}

export function parseColor(css) {
  if (!css) return null;
  const s = String(css).trim();
  if (s === 'transparent' || s === 'none') return { rgb: [0, 0, 0], alpha: 0 };
  const raw = s.match(/-?[\d.]+%?/g);
  if (!raw) return null;
  const nums = raw.map((t) => (t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t)));
  // Before the oklch test: `oklch` does not contain `oklab`, but keeping the more
  // specific name first makes the ordering obvious rather than incidental.
  if (/^oklab\(/i.test(s)) {
    if (nums.length < 3) return null;
    // L may be written 0..1 or as a percentage; the shared `%` handling above already
    // divided a percentage by 100, which is the 0..1 form this transform wants.
    return { rgb: oklabToRgb(nums[0], nums[1], nums[2]), alpha: nums[3] ?? 1 };
  }
  if (/^oklch/i.test(s)) {
    if (nums.length < 3) return null;
    return { rgb: oklchToRgb(nums[0] > 1 ? nums[0] / 100 : nums[0], nums[1], nums[2]), alpha: nums[3] ?? 1 };
  }
  if (/^rgb/i.test(s)) {
    if (nums.length < 3) return null;
    const pct = s.includes('%');
    return {
      rgb: nums.slice(0, 3).map((n) => Math.round(pct && n <= 1 ? n * 255 : n)),
      alpha: nums[3] ?? 1,
    };
  }
  // Tailwind v4's default palette. Matched after oklab/oklch so `oklab(` cannot fall in
  // here through the substring.
  if (/^lab\(/i.test(s)) {
    if (nums.length < 3) return null;
    // L may be written as a percentage, which the shared `%`-handling above already
    // divided by 100 -- put it back on the 0..100 scale lab() expects.
    const pctL = /^lab\(\s*-?[\d.]+%/i.test(s);
    const L = pctL ? nums[0] * 100 : nums[0];
    return { rgb: labToRgb(L, nums[1], nums[2]), alpha: nums[3] ?? 1 };
  }
  return null;
}

export const relLuminance = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

export const contrast = (a, b) => {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Composite a translucent colour over an opaque one. */
export const composite = (fg, alpha, bg) =>
  fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

/**
 * Resolve the opaque colour behind an element from its ancestors' background
 * colours, compositing any translucent layers on the way down.
 */
export function groundFromChain(chain, fallback = [255, 255, 255], unreadable) {
  let acc = null;
  for (const raw of chain) {
    const c = parseColor(raw);
    // An unparseable layer is NOT an absent one. Skipping both alike means a translucent
    // overlay this parser cannot read is treated as though it were not there, and the text
    // is judged against whatever is behind it — an error in the direction of a false PASS,
    // which clean output can never reveal. Callers may pass an array to hear about it.
    if (!c) {
      if (unreadable && raw) unreadable.push(String(raw));
      continue;
    }
    if (c.alpha === 0) continue;
    if (acc === null) {
      if (c.alpha >= 0.999) return c.rgb;
      acc = c;
      continue;
    }
    if (c.alpha >= 0.999) return composite(acc.rgb, acc.alpha, c.rgb);
  }
  return acc ? composite(acc.rgb, acc.alpha, fallback) : fallback;
}

/**
 * In-page collector. Returns the colour STRINGS plus enough context to decide
 * whether the reading is trustworthy — the maths runs in node, where this
 * module lives.
 *
 * `paintedByImage` marks a node whose own box or an ancestor's is filled by a
 * gradient or image. Its true ground is not in any backgroundColor, so those
 * are reported separately rather than counted as failures on a guess.
 */
export const COLLECT_TEXT_NODES = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue;
    const text = (el.textContent || '').trim();
    if (text.length < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.5) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const chain = [];
    let paintedByImage = false;
    // The gradient actually painting behind this text, so its stops can be measured
    // instead of the node being dropped as unknowable.
    let paintImage = '';
    // Where in the chain that gradient sits. Layers nearer than this one are painted in
    // FRONT of it, so an opaque one among them means the gradient is not the ground.
    let paintIndex = -1;
    let n = el;
    while (n && n !== document.documentElement && chain.length < 14) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') {
        paintedByImage = true;
        if (!paintImage) {
          paintImage = s.backgroundImage;
          paintIndex = chain.length;
        }
      }
      chain.push(s.backgroundColor);
      n = n.parentElement;
    }
    chain.push(getComputedStyle(document.body).backgroundColor);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    out.push({
      text: text.slice(0, 44),
      fg: cs.color,
      chain,
      paintedByImage,
      large: size >= 24 || (size >= 18.66 && weight >= 700),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 70),
      tag: el.tagName.toLowerCase(),
      paintImage: paintImage.slice(0, 300),
      paintIndex,
    });
  }
  return out;
})()`;

/** Measure one collected node. Returns null when it cannot be judged fairly. */
/**
 * The colour stops of a computed gradient, in order.
 *
 * A computed `backgroundImage` carries resolved colours, so the stops are readable
 * without evaluating the gradient. The interpolation hint in
 * `linear-gradient(to right bottom in oklab, ...)` is deliberately NOT matched: `oklab`
 * there is a colour SPACE, not a colour, and it is written without parentheses.
 */
export function gradientStops(image) {
  if (!image) return [];
  const tokens = String(image).match(
    /(?:rgba?|oklch|oklab|lab|lch|hsla?|color)\([^()]*\)|#[0-9a-fA-F]{3,8}/g,
  );
  if (!tokens) return [];
  const stops = [];
  for (const token of tokens) {
    const parsed = parseColor(token);
    if (parsed) stops.push(parsed);
  }
  return stops;
}

export function judge(node) {
  const fg = parseColor(node.fg);
  // Say WHY, rather than returning a bare null that a caller cannot tell apart from
  // "nothing to report". An unparseable colour used to disappear here: the sweep's
  // `if (v && !v.passes)` treated it as a pass, so 126 lab() colours -- Tailwind v4's
  // entire default palette -- were never measured while the sweep reported a total as
  // though they had been. Callers must count `unmeasured` and print it.
  if (!fg) return { unmeasured: 'unparseable-colour', raw: node.fg, passes: true, ratio: null };
  // Text over a gradient. Rather than dropping it -- which is what used to happen, and
  // which made every text node on the signed-out pages invisible to this check -- the
  // gradient's own colour stops are read out of the computed value and the WORST of them
  // is used. That holds wherever on the gradient the text sits, needs no geometry, and is
  // conservative by construction.
  // Any layer the parser could not read makes the ground a guess, so say so rather than
  // return a number that looks authoritative.
  const unreadable = [];
  if (node.paintedByImage) {
    const stops = gradientStops(node.paintImage);
    if (!stops.length) {
      return { unmeasured: 'painted-by-image', raw: node.paintImage, passes: true, ratio: null };
    }
    // Only the layers IN FRONT of the gradient can hide it. Resolving just those over
    // each stop means a button with its own opaque fill is judged against that fill, and
    // bare text on the page is judged against the gradient -- which is the difference
    // between a real reading and white-on-white.
    const inFront = node.paintIndex > 0 ? node.chain.slice(0, node.paintIndex) : [];
    let worst = null;
    for (const stop of stops) {
      const ground = groundFromChain(inFront, stop.rgb);
      const ink = fg.alpha >= 0.999 ? fg.rgb : composite(fg.rgb, fg.alpha, ground);
      const r = contrast(ink, ground);
      if (worst === null || r < worst.ratio) worst = { ratio: r, fg: ink, bg: ground };
    }
    const floor = node.large ? 3 : 4.5;
    return { ...worst, floor, passes: worst.ratio >= floor, overGradient: true };
  }
  const bg = groundFromChain(node.chain, [255, 255, 255], unreadable);
  if (unreadable.length) {
    return { unmeasured: 'unreadable-layer', raw: unreadable[0], passes: true, ratio: null };
  }
  const text = fg.alpha >= 0.999 ? fg.rgb : composite(fg.rgb, fg.alpha, bg);
  const ratio = contrast(text, bg);
  const floor = node.large ? 3 : 4.5;
  return { ratio, floor, passes: ratio >= floor, fg: text, bg };
}
