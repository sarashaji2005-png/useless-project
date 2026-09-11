import { palette, withAlpha } from '../design/tokens';

/**
 * Single source of truth for how a visibility score is written and coloured.
 *
 * Everything — overlay badges, callouts, console diagnostics — formats through
 * here, so the score can never appear as "82%" in one place and "82/100" in
 * another.
 */

/**
 * SCORE SEMANTICS. This one constant controls both the suggestion direction and
 * the colour bands, so they can never disagree.
 *
 * false (default) — the score is EXPOSURE. High means the teacher can see you,
 *   which is bad for a project about not being seen. So:
 *     high score -> red (danger), low score -> green (safe)
 *     suggestions point at LOWER-scoring empty seats
 *
 * true — the literal reading of the spec as written, where a higher score is
 *   "better":
 *     high score -> green, low score -> red
 *     suggestions point at HIGHER-scoring empty seats
 *
 * Flip this single line to switch both behaviours together.
 */
export const HIGHER_IS_BETTER = false;

/** Band edges, in points. */
export const BAND_LOW = 40;
export const BAND_HIGH = 70;

/**
 * The chosen format, used everywhere. "XX/100" over "XX%" because at projector
 * distance the "/100" reads as a scale without needing a legend, and it will
 * not be misread as the occlusion percentages elsewhere on the overlay.
 */
export function formatScore(score: number): string {
  return `${Math.round(score)}/100`;
}

/** Bare number, for tight spaces like the comparison in a suggestion callout. */
export function formatScoreShort(score: number): string {
  return String(Math.round(score));
}

export type ScoreBand = 'low' | 'mid' | 'high';

export function scoreBand(score: number): ScoreBand {
  if (score < BAND_LOW) return 'low';
  if (score <= BAND_HIGH) return 'mid';
  return 'high';
}

export interface BandStyle {
  /** Text and ring colour. */
  fg: string;
  /** Badge fill. Kept dark and near-opaque so the badge survives a bright frame. */
  bg: string;
  /** Short word for the band, drawn under the circle. */
  label: string;
}

/**
 * Band colours come from the shared design tokens, so the canvas badges and the
 * DOM chrome can never disagree about what "amber" is.
 *
 * Red here is not decorative: a high exposure score genuinely is the alert
 * condition this project exists to avoid, which is the one use the reserved red
 * is for.
 */
const DANGER: BandStyle = {
  fg: palette.red,
  bg: withAlpha(palette.redDim, 0.9),
  label: 'EXPOSED',
};
const CAUTION: BandStyle = {
  fg: palette.amber,
  bg: withAlpha(palette.amberDim, 0.85),
  label: 'PARTIAL',
};
const SAFE: BandStyle = {
  fg: palette.green,
  bg: withAlpha(palette.greenDim, 0.85),
  label: 'CONCEALED',
};

export function bandStyle(score: number): BandStyle {
  const band = scoreBand(score);
  if (band === 'mid') return CAUTION;

  // Under exposure semantics a high score is the dangerous one. Under the
  // literal-spec reading it is the good one.
  const highIsGood = HIGHER_IS_BETTER;
  if (band === 'high') return highIsGood ? SAFE : DANGER;
  return highIsGood ? DANGER : SAFE;
}

/**
 * Signed improvement of `candidate` over `current`, in points, under the active
 * semantics. Always positive when the candidate is genuinely preferable.
 */
export function improvement(candidateScore: number, currentScore: number): number {
  return HIGHER_IS_BETTER
    ? candidateScore - currentScore
    : currentScore - candidateScore;
}

/** Word used in the callout, so wording tracks the semantics automatically. */
export const BETTER_WORD = HIGHER_IS_BETTER ? 'BETTER' : 'SAFER';
