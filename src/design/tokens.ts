/**
 * DESIGN TOKENS — single source of truth for the whole app.
 *
 * Why TypeScript and not just CSS custom properties: most of this UI is drawn on
 * a <canvas>, and canvas cannot read CSS variables. If the palette lived only in
 * CSS, every overlay colour would have to be hardcoded in JS and the two would
 * drift apart within a week.
 *
 * So the palette is defined here once, and `applyDesignTokens()` writes it into
 * CSS custom properties on :root at boot. CSS consumes `var(--*)`, canvas code
 * imports the object. One definition, no duplication, no drift.
 */

// ---------------------------------------------------------------- palette

export const palette = {
  /**
   * Base charcoal. Kept near-black so a projector's black level does not muddy
   * everything sitting on top of it.
   */
  bg: '#0A0C0F',

  /**
   * Raised surfaces: panels, button faces.
   *
   * Lifted further off the base than a typical dark theme, because a projector
   * crushes dark tones — two near-blacks that read as distinct on a monitor
   * become one flat black in a lit room. Measured separation is ~1.23:1 base to
   * surface-1, which is thin but is backed by a visible border, never fill alone.
   */
  surface1: '#24221E',
  surface2: '#3A352D',

  /** Decorative hairlines and dividers. Not load-bearing for comprehension. */
  line: '#2E2A26',
  lineStrong: '#423C34',

  /**
   * Border colour for INTERACTIVE controls: buttons, toggles.
   *
   * Separate token because WCAG 2.1 non-text contrast (1.4.11) wants 3:1 against
   * the adjacent background for anything identifying a UI component. The
   * decorative hairlines above sit around 1.4:1, which is right for a divider and
   * wrong for a button edge. This one measures ~3.4:1.
   */
  borderInteractive: '#6B655C',

  /**
   * PRIMARY — radar amber. Phosphor-display colour, used for chrome, borders,
   * active states, badge rings, the roaming indicator.
   */
  amber: '#FFB000',
  amberDim: '#8A5F00',
  amberBright: '#FFCB4D',

  /**
   * ALERT — threat red. RESERVED. Only ever means "something is wrong":
   * high-exposure scores, abort states, urgency. Never decorative.
   */
  red: '#FF3B30',
  redDim: '#7A1C17',

  /** SAFE — signal green. Low-exposure scores, safe windows. */
  green: '#00E68A',
  greenDim: '#00734A',

  /**
   * CORAL — the playful lead. Screen 2 reveal, and a full member of the
   * maximalist accent set on the landing page.
   */
  playful: '#FF4D8D',
  playfulBright: '#FF8FB8',
  playfulDeep: '#5C1030',

  /**
   * YELLOW — added for the maximalist direction.
   *
   * Note this was previously REJECTED for the single playful-accent slot, because
   * at ~5° from amber it could not read as a rule-break against amber chrome.
   * That reasoning still holds; the role is just different now. As one of several
   * layered accents it does useful work as a bright highlight, provided it is
   * never the thing distinguishing a state from amber.
   */
  yellow: '#FFD23F',
  yellowDeep: '#4A3A00',

  /**
   * VIOLET — the one cool accent.
   *
   * Everything else in the palette is warm (amber, coral, yellow, red), which
   * left the layered blocks reading as one orange smear. A cool colour is what
   * makes the density read as variety rather than mud.
   */
  /**
   * Darkened from an initial #7C5CFF, which sat at mid-luminance and failed both
   * ways — 3.86:1 with white ink and worse with black. Violet is the one accent
   * with no comfortable ink choice at full brightness, so it has to be pushed
   * dark enough for white to work.
   */
  violet: '#6B45F0',
  violetDeep: '#20135C',

  /**
   * Warm grey text ramp. R > G > B throughout, so the neutrals read as part of
   * the amber family rather than generic cool-grey dark mode.
   */
  textBright: '#F5F1E8',
  text: '#D6D0C6',
  textDim: '#8A857E',
  /** Lightened to clear the 3:1 non-text contrast floor; was failing at 2.77:1. */
  textFaint: '#6E6A63',
} as const;

/**
 * The maximalist accent set, in the order things should cycle through it.
 *
 * Deliberately EXCLUDES red. Red keeps its reserved meaning — "something is
 * wrong" — and putting it in a decorative rotation is exactly how that meaning
 * gets diluted. Everything on the landing page that needs a colour pulls from
 * here, so no component picks a hex directly.
 */
export type AccentName = 'amber' | 'coral' | 'yellow' | 'green' | 'violet';

export const ACCENTS: readonly AccentName[] = [
  'amber',
  'coral',
  'yellow',
  'green',
  'violet',
] as const;

export const accent: Record<AccentName, { base: string; deep: string; ink: string }> = {
  // `ink` is the text colour to use ON that accent as a fill. Every one of these
  // pairs is contrast-checked in scripts/verifyDesign.ts.
  amber: { base: palette.amber, deep: palette.amberDim, ink: palette.bg },
  coral: { base: palette.playful, deep: palette.playfulDeep, ink: palette.bg },
  yellow: { base: palette.yellow, deep: palette.yellowDeep, ink: palette.bg },
  green: { base: palette.green, deep: palette.greenDim, ink: palette.bg },
  violet: { base: palette.violet, deep: palette.violetDeep, ink: palette.textBright },
};

/** Hard offset shadow distance for the card/sticker treatment. */
export const SHADOW_OFFSET = 6;

// ------------------------------------------------------------ typography

/**
 * Three roles, deliberately no webfonts.
 *
 * A Google Fonts link means text silently falls back if the venue network is
 * slow or down, and a font swapping mid-demo is an avoidable failure. Everything
 * here resolves from system fonts on Windows and macOS.
 */

/** DISPLAY — condensed technical grotesque. Headlines only. Reads as instrument
 *  panel labelling, which is the point of pairing it against the mono. */
export const FONT_DISPLAY =
  "'Bahnschrift SemiCondensed', 'Bahnschrift', 'DIN Alternate', 'Futura Condensed', 'Arial Narrow', 'Segoe UI', sans-serif";

/** MONO — all data: scores, telemetry, coordinates, ids. */
export const FONT_MONO =
  "'JetBrains Mono', 'Cascadia Mono', Consolas, 'Courier New', monospace";

/** PLAYFUL — Screen 2 reveal caption only. */
export const FONT_PLAYFUL =
  "'Comic Sans MS', 'Comic Sans', 'Chalkboard SE', 'Comic Neue', cursive";

/**
 * Playful stack extended to cover MALAYALAM.
 *
 * Comic Sans MS contains no Malayalam glyphs — used alone it renders
 * "കസേര കണ്ടില്ലേ?" as tofu boxes. Browsers fall back per GLYPH rather than per
 * element, so listing a Malayalam-capable family after the cartoon one gives
 * Latin characters Comic Sans and Malayalam characters Nirmala UI. Canvas
 * `fillText` and `measureText` honour the same fallback chain.
 *
 * Nirmala UI ships with Windows 8+, Malayalam Sangam MN with macOS. Still no
 * webfont, so nothing here can fail to load mid-demo.
 *
 * HONEST LIMITATION: there is no cartoonish Malayalam system font, so the
 * Malayalam glyphs render in a clean sans and will not look hand-drawn the way
 * the Latin reveal text does. Fixing that properly needs a bundled display face
 * with Malayalam coverage, which reintroduces the webfont failure mode.
 */
export const FONT_PLAYFUL_INTL =
  "'Comic Sans MS', 'Comic Sans', 'Chalkboard SE', 'Nirmala UI', 'Malayalam Sangam MN', 'Noto Sans Malayalam', sans-serif";

// ------------------------------------------------------------- geometry

/** One corner treatment everywhere. Near-sharp, so it reads as equipment
 *  without the accessibility cost of clip-path (which clips focus rings). */
export const RADIUS = 2;
export const RADIUS_PILL = 999;

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 18, xl: 28 } as const;

// -------------------------------------------------------------- helpers

/** Hex to rgba string. Used constantly by the canvas overlays. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Canvas font shorthand builders. */
export function displayFont(px: number, weight = '600'): string {
  return `${weight} ${px}px ${FONT_DISPLAY}`;
}
export function monoFont(px: number, weight = ''): string {
  return `${weight ? `${weight} ` : ''}${px}px ${FONT_MONO}`;
}
export function playfulFont(px: number, weight = 'bold'): string {
  return `${weight} ${px}px ${FONT_PLAYFUL}`;
}

/** Playful, but able to render Malayalam. Use for any non-Latin reveal copy. */
export function playfulIntlFont(px: number, weight = 'bold'): string {
  return `${weight} ${px}px ${FONT_PLAYFUL_INTL}`;
}

// ------------------------------------------------- CSS variable injection

/**
 * Mirror the tokens into CSS custom properties.
 *
 * Called once at boot, before render. Keeping this generated from the same
 * object the canvas uses is the whole reason the palette cannot drift between
 * the DOM chrome and the overlays.
 */
export function applyDesignTokens(root: HTMLElement = document.documentElement): void {
  const vars: Record<string, string> = {
    '--bg': palette.bg,
    '--surface-1': palette.surface1,
    '--surface-2': palette.surface2,
    '--line': palette.line,
    '--line-strong': palette.lineStrong,
    '--border-interactive': palette.borderInteractive,

    '--amber': palette.amber,
    '--amber-dim': palette.amberDim,
    '--amber-bright': palette.amberBright,

    '--red': palette.red,
    '--red-dim': palette.redDim,

    '--green': palette.green,
    '--green-dim': palette.greenDim,

    '--playful': palette.playful,
    '--playful-bright': palette.playfulBright,
    '--playful-deep': palette.playfulDeep,

    '--coral': palette.playful,
    '--coral-deep': palette.playfulDeep,
    '--yellow': palette.yellow,
    '--yellow-deep': palette.yellowDeep,
    '--violet': palette.violet,
    '--violet-deep': palette.violetDeep,

    '--shadow-offset': `${SHADOW_OFFSET}px`,

    '--text-bright': palette.textBright,
    '--text': palette.text,
    '--text-dim': palette.textDim,
    '--text-faint': palette.textFaint,

    '--font-display': FONT_DISPLAY,
    '--font-mono': FONT_MONO,
    '--font-playful': FONT_PLAYFUL,
    '--font-playful-intl': FONT_PLAYFUL_INTL,

    '--radius': `${RADIUS}px`,
    '--space-xs': `${SPACE.xs}px`,
    '--space-sm': `${SPACE.sm}px`,
    '--space-md': `${SPACE.md}px`,
    '--space-lg': `${SPACE.lg}px`,
    '--space-xl': `${SPACE.xl}px`,

    '--glow-amber': `0 0 0 1px ${withAlpha(palette.amber, 0.35)}, 0 0 18px ${withAlpha(palette.amber, 0.28)}`,
    '--glow-red': `0 0 0 1px ${withAlpha(palette.red, 0.4)}, 0 0 20px ${withAlpha(palette.red, 0.32)}`,
  };

  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}
