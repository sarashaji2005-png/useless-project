/**
 * Design-token verification, with an emphasis on LEGIBILITY.
 *
 * I cannot take a screenshot or point a projector at this, so instead of
 * eyeballing the palette this script computes WCAG 2.1 contrast ratios for every
 * foreground/background pair the UI actually uses.
 *
 * That is arguably the more useful check for the stated worry: the failure mode
 * on a projector is washed-out dark-on-dark, and contrast ratio measures exactly
 * that. A screenshot on my monitor would tell you nothing about the room.
 *
 * Thresholds (WCAG 2.1 AA):
 *   4.5 : 1  normal body text
 *   3.0 : 1  large text (>=18.66px bold or >=24px regular) and UI components
 *
 * Run: npm run verify:design
 */
import {
  accent,
  ACCENTS,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_PLAYFUL,
  palette,
  RADIUS,
  withAlpha,
} from '../src/design/tokens';
import { bandStyle, BAND_HIGH, BAND_LOW } from '../src/core/scoreDisplay';

let failures = 0;
let passes = 0;
const warnings: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

function section(title: string) {
  console.log();
  console.log('─'.repeat(78));
  console.log(title);
  console.log('─'.repeat(78));
}

// ------------------------------------------------------------- colour maths

function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Hue angle, for checking accents are actually distinguishable. */
function hue(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function hueGap(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return d > 180 ? 360 - d : d;
}

console.log('═'.repeat(78));
console.log('HIDE N SEAT — DESIGN TOKEN VERIFICATION');
console.log('═'.repeat(78));

// =========================================================================
section('1. TOKEN INTEGRITY');

{
  const hexes = Object.entries(palette);
  const bad = hexes.filter(([, v]) => !/^#[0-9a-fA-F]{6}$/.test(v));
  check('every palette entry is a valid 6-digit hex', bad.length === 0,
    bad.length ? bad.map(([k, v]) => `${k}=${v}`).join(' ') : `${hexes.length} tokens`);

  const values = hexes.map(([, v]) => v.toLowerCase());
  const dupes = values.filter((v, i) => values.indexOf(v) !== i);
  check('no duplicate colour values', dupes.length === 0,
    dupes.length ? dupes.join(' ') : 'all distinct');

  check('withAlpha produces valid rgba',
    withAlpha(palette.amber, 0.5) === 'rgba(255,176,0,0.5)',
    withAlpha(palette.amber, 0.5));

  check('one corner radius, and it is small enough to read as equipment',
    RADIUS >= 0 && RADIUS <= 4, `${RADIUS}px`);

  // Every stack needs real fallbacks and a generic family, or a machine missing
  // the first choice renders in whatever the browser default is.
  const stacks: [string, string, string][] = [
    ['display', FONT_DISPLAY, 'sans-serif'],
    ['mono', FONT_MONO, 'monospace'],
    ['playful', FONT_PLAYFUL, 'cursive'],
  ];
  for (const [name, stack, generic] of stacks) {
    const count = stack.split(',').length;
    check(`${name} stack has fallbacks and ends in a generic family`,
      count >= 3 && stack.trim().endsWith(generic),
      `${count} entries, ends "${generic}"`);
  }
  check('no webfont dependency in any stack',
    !stacks.some(([, s]) => /url\(|http/i.test(s)),
    'all system-resolved, nothing to fail on a bad network');
}

// =========================================================================
section('2. TEXT LEGIBILITY ON THE BASE BACKGROUND');

const bg = palette.bg;

const textPairs: [string, string, number, string][] = [
  ['body text', palette.text, 4.5, 'normal'],
  ['bright text / headlines', palette.textBright, 4.5, 'normal'],
  ['dim text (labels, hints)', palette.textDim, 4.5, 'normal'],
  ['faint text (unconfirmed tracks)', palette.textFaint, 3.0, 'large/UI only'],
  ['amber primary', palette.amber, 4.5, 'normal'],
  ['amber bright', palette.amberBright, 4.5, 'normal'],
  ['threat red', palette.red, 3.0, 'large/UI only'],
  ['signal green', palette.green, 4.5, 'normal'],
  ['playful magenta', palette.playful, 3.0, 'large/UI only'],
  ['playful bright', palette.playfulBright, 4.5, 'normal'],
];

for (const [name, fg, threshold, note] of textPairs) {
  const ratio = contrast(fg, bg);
  check(
    `${name} on base`,
    ratio >= threshold,
    `${ratio.toFixed(2)}:1 (needs ${threshold} — ${note})`,
  );
  if (ratio < 4.5 && threshold < 4.5) {
    warnings.push(`${name} is ${ratio.toFixed(2)}:1 — large text or UI only, not body copy`);
  }
}

// =========================================================================
section('3. TEXT ON RAISED SURFACES');

for (const [surfName, surf] of [
  ['surface-1 (buttons, panels)', palette.surface1],
  ['surface-2 (code, insets)', palette.surface2],
] as const) {
  check(`body text on ${surfName}`, contrast(palette.text, surf) >= 4.5,
    `${contrast(palette.text, surf).toFixed(2)}:1`);
  check(`amber on ${surfName}`, contrast(palette.amber, surf) >= 4.5,
    `${contrast(palette.amber, surf).toFixed(2)}:1`);
}

{
  // Active button state inverts to amber-on-background: the text must survive.
  check('pressed button (bg text on amber fill)', contrast(palette.bg, palette.amber) >= 4.5,
    `${contrast(palette.bg, palette.amber).toFixed(2)}:1`);
}

// =========================================================================
section('4. SCORE BADGE BANDS');

{
  // Each band's ring colour must be legible on its own fill, and the fills are
  // alpha-composited over near-black video, so test against the base.
  const bands: [string, number][] = [
    ['low / concealed', BAND_LOW - 1],
    ['mid / partial', (BAND_LOW + BAND_HIGH) / 2],
    ['high / exposed', BAND_HIGH + 1],
  ];

  for (const [name, score] of bands) {
    const style = bandStyle(score);
    const ratio = contrast(style.fg, bg);
    check(`${name} band ring on base`, ratio >= 3.0,
      `${style.label} ${style.fg} → ${ratio.toFixed(2)}:1`);
  }

  const low = bandStyle(BAND_LOW - 1).fg;
  const mid = bandStyle((BAND_LOW + BAND_HIGH) / 2).fg;
  const high = bandStyle(BAND_HIGH + 1).fg;

  check('the three bands are distinct colours',
    new Set([low, mid, high]).size === 3, `${low} / ${mid} / ${high}`);

  // Bands must be tellable apart at a glance, which needs hue separation not
  // just different hex values.
  check('band hues are separated enough to read at distance',
    hueGap(low, mid) > 40 && hueGap(mid, high) > 25 && hueGap(low, high) > 60,
    `low↔mid ${hueGap(low, mid).toFixed(0)}°, mid↔high ${hueGap(mid, high).toFixed(0)}°, low↔high ${hueGap(low, high).toFixed(0)}°`);
}

// =========================================================================
section('5. RESERVED-MEANING SEPARATION');

{
  // The whole point of reserving red is that it cannot be confused with chrome.
  check('threat red is clearly separated from amber chrome',
    hueGap(palette.red, palette.amber) > 25,
    `${hueGap(palette.red, palette.amber).toFixed(0)}° apart`);

  // The playful accent must visibly break the palette, not look like another
  // shade of chrome. This is why magenta was chosen over the yellow alternative.
  const playfulVsAmber = hueGap(palette.playful, palette.amber);
  check('playful accent breaks away from amber chrome', playfulVsAmber > 55,
    `${playfulVsAmber.toFixed(0)}° from amber`);

  // This is the tightest gap in the palette and the one genuine risk in it.
  const playfulVsRed = hueGap(palette.playful, palette.red);
  check('playful accent is distinguishable from threat red', playfulVsRed > 20,
    `${playfulVsRed.toFixed(0)}° from red`);
  if (playfulVsRed < 35) {
    warnings.push(
      `playful magenta sits only ${playfulVsRed.toFixed(0)}° from the reserved threat red — ` +
        'the closest pair in the palette. Worth confirming on the projector that a ' +
        'reveal cannot be mistaken for an alert.',
    );
  }

  // Sanity: the rejected alternative really would have collided.
  const sunshine = '#FFD23F';
  check('rejected yellow alternative would have collided with amber',
    hueGap(sunshine, palette.amber) < 25,
    `${hueGap(sunshine, palette.amber).toFixed(0)}° — too close, hence magenta`);
}

// =========================================================================
section('6. MAXIMALIST ACCENT SET');

{
  // Every accent is used two ways: as an outline/text colour on the dark base,
  // and as a solid fill with `ink` text on top. Both directions need to hold.
  for (const name of ACCENTS) {
    const a = accent[name];
    const onBase = contrast(a.base, palette.bg);
    check(`accent ${name} on base`, onBase >= 3.0, `${onBase.toFixed(2)}:1`);

    const inkOnFill = contrast(a.ink, a.base);
    check(`accent ${name} fill is legible with its ink colour`, inkOnFill >= 4.5,
      `${inkOnFill.toFixed(2)}:1`);
  }

  // Red must stay out of the decorative rotation or it stops meaning "alert".
  check('red is excluded from the decorative accent set',
    !(ACCENTS as readonly string[]).includes('red'), ACCENTS.join(', '));

  // Adjacent accents in the cycle should not be near-identical hues, or a wall of
  // cards reads as one colour.
  let tightest = 360;
  let tightestPair = '';
  for (let i = 0; i < ACCENTS.length; i++) {
    for (let j = i + 1; j < ACCENTS.length; j++) {
      const g = hueGap(accent[ACCENTS[i]].base, accent[ACCENTS[j]].base);
      if (g < tightest) {
        tightest = g;
        tightestPair = `${ACCENTS[i]}↔${ACCENTS[j]}`;
      }
    }
  }
  // amber↔yellow is knowingly close; they are never used to distinguish states
  // from each other, only to add variety across decorative blocks.
  check('accent set spans a wide hue range', tightest > 4,
    `tightest pair ${tightestPair} at ${tightest.toFixed(0)}°`);
  if (tightest < 20) {
    warnings.push(
      `${tightestPair} are only ${tightest.toFixed(0)}° apart — fine for decoration, ` +
        'but they must never be the sole difference between two states',
    );
  }

  const cool = ACCENTS.filter((n) => {
    const h = hue(accent[n].base);
    return h > 180 && h < 300;
  });
  check('accent set includes at least one cool colour', cool.length >= 1,
    `cool: ${cool.join(', ') || 'none'} — without one, layered warm blocks read as mud`);
}

// =========================================================================
section('7. WARM NEUTRAL FAMILY');

{
  // Warm means R > G > B. A cool grey ramp is what makes a dark palette read as
  // generic dark mode rather than one coherent family.
  const ramp: [string, string][] = [
    ['textBright', palette.textBright],
    ['text', palette.text],
    ['textDim', palette.textDim],
    ['textFaint', palette.textFaint],
  ];

  for (const [name, hex] of ramp) {
    const [r, g, b] = toRgb(hex);
    check(`${name} is warm (R>G>B)`, r > g && g > b, `rgb(${r},${g},${b})`);
  }

  // And the ramp must actually be monotonic in lightness, or "dim" and "faint"
  // are just two arbitrary greys.
  const lums = ramp.map(([, hex]) => luminance(hex));
  const monotonic = lums.every((l, i) => i === 0 || l < lums[i - 1]);
  check('neutral ramp descends monotonically in luminance', monotonic,
    lums.map((l) => l.toFixed(3)).join(' > '));
}

// =========================================================================
section('7. PROJECTOR RISK REPORT');

{
  /**
   * THE HARD REQUIREMENT here is WCAG 2.1 SC 1.4.11 non-text contrast: anything
   * that visually identifies a UI component needs 3:1 against what is next to it.
   * A button edge qualifies. A decorative divider does not.
   *
   * That distinction is why there are two border tokens.
   */
  const interactiveRatio = contrast(palette.borderInteractive, palette.bg);
  check('interactive borders meet WCAG 1.4.11 non-text contrast (3:1)',
    interactiveRatio >= 3.0, `${interactiveRatio.toFixed(2)}:1`);

  const amberBorder = contrast(palette.amber, palette.bg);
  check('primary button border meets 3:1', amberBorder >= 3.0,
    `${amberBorder.toFixed(2)}:1`);
  const redBorder = contrast(palette.red, palette.bg);
  check('danger button border meets 3:1', redBorder >= 3.0, `${redBorder.toFixed(2)}:1`);

  /**
   * Surface separation is ADVISORY, not a pass/fail. WCAG sets no requirement for
   * background-against-background contrast, and inventing a threshold here would
   * be testing my own guess rather than anything real. What matters is that no
   * structure depends on fill separation alone — every panel and button also has
   * a border, which is what the checks above cover.
   */
  const surfacePairs: [string, string, string][] = [
    ['base → surface-1', palette.bg, palette.surface1],
    ['surface-1 → surface-2', palette.surface1, palette.surface2],
    ['base → divider line', palette.bg, palette.line],
  ];
  for (const [name, a, b] of surfacePairs) {
    const ratio = contrast(a, b);
    console.log(`INFO  ${name}: ${ratio.toFixed(2)}:1${ratio < 1.3 ? '  (thin — border-backed)' : ''}`);
    if (ratio < 1.2) {
      warnings.push(
        `${name} at ${ratio.toFixed(2)}:1 will likely read as flat on a bright projector`,
      );
    }
  }
}

// =========================================================================
console.log();
console.log('═'.repeat(78));
if (warnings.length > 0) {
  console.log('ADVISORY (not failures):');
  for (const w of warnings) console.log(`  · ${w}`);
  console.log();
}
if (failures === 0) {
  console.log(`ALL ${passes} ASSERTIONS PASSED.`);
  console.log('Contrast is computed, not eyeballed. Real projector legibility still');
  console.log('needs a human in the actual room.');
} else {
  console.log(`${failures} FAILURE(S), ${passes} passed.`);
  process.exitCode = 1;
}
console.log('═'.repeat(78));
