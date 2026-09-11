import { centroid } from './geometry2d';
import type { Box, Point, TickResult } from '../models/types';

/**
 * Uniform random chair selection.
 *
 * Note this is deliberately NOT the risk-ranked "safest seat" logic that used to
 * live here. Selection is now a flat coin toss across the vacant chairs — no
 * visibility weighting, no luck factor, no ranking.
 *
 * Fallback rule: if nothing is vacant, pick from ALL tracked chairs rather than
 * failing. A round that produces no answer would need an error state, and the
 * spec calls for the pick to just happen.
 */

export interface ChairTarget {
  seatId: string;
  box: Box;
  centre: Point;
  occupied: boolean;
}

export interface PickResult {
  seatId: string;
  /**
   * Box captured at pick time.
   *
   * Snapshotted rather than read live during the reveal, because the tracker
   * keeps nudging boxes every tick and the rising animation would jitter if it
   * chased a moving anchor.
   */
  box: Box;
  centre: Point;
  /** False when the vacant pool was empty and we fell back to all chairs. */
  fromVacant: boolean;
  poolSize: number;
}

/** Confirmed chairs with their current occupancy, from the live tick. */
export function trackedChairs(result: TickResult | null): ChairTarget[] {
  if (!result) return [];

  const occupiedById = new Map(result.seatStates.map((s) => [s.seatId, s.occupied]));

  return result.chairs
    .filter((c) => c.confirmed)
    .map((c) => ({
      seatId: c.id,
      box: c.box,
      centre: centroid(c.box),
      // A confirmed chair with no seat state yet has not been scored, which only
      // happens before the teacher point is set. Treat it as vacant.
      occupied: occupiedById.get(c.id) ?? false,
    }));
}

export function vacantChairs(result: TickResult | null): ChairTarget[] {
  return trackedChairs(result).filter((c) => !c.occupied);
}

/**
 * Pick one chair uniformly at random.
 *
 * Returns null only when there are no tracked chairs at all — the caller treats
 * that as "nothing to do" rather than an error, so an empty frame cannot crash
 * the round.
 */
export function pickRandomChair(
  result: TickResult | null,
  rng: () => number = Math.random,
): PickResult | null {
  const vacant = vacantChairs(result);
  const fromVacant = vacant.length > 0;
  const pool = fromVacant ? vacant : trackedChairs(result);

  if (pool.length === 0) return null;

  // Math.min guards the pathological rng() === 1 case, which would index out of
  // bounds and hand back undefined.
  const chosen = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];

  return {
    seatId: chosen.seatId,
    box: chosen.box,
    centre: chosen.centre,
    fromVacant,
    poolSize: pool.length,
  };
}

// ---------------------------------------------------------------- reveal

/** Total length of the rising reveal. */
export const REVEAL_MS = 1500;

/** How far the chair lifts, as a multiple of its own box height. */
export const RISE_FACTOR = 1.1;

/** Extra scale at full rise. */
export const RISE_SCALE = 0.18;

/** easeOutCubic — fast lift-off, gentle settle. */
export function easeOutCubic(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - Math.pow(1 - c, 3);
}

export interface RiseTransform {
  /** Progress 0-1 through the reveal. */
  eased: number;
  box: Box;
}

/**
 * The risen box at a given moment.
 *
 * Scaling happens about the box CENTRE, not its top-left, so the chair grows in
 * place instead of drifting sideways as it lifts.
 */
export function riseTransform(box: Box, elapsedMs: number): RiseTransform {
  const eased = easeOutCubic(elapsedMs / REVEAL_MS);

  const cx = box.px + box.width / 2;
  const cy = box.py + box.height / 2;
  const scale = 1 + RISE_SCALE * eased;
  const dy = -RISE_FACTOR * box.height * eased;

  const width = box.width * scale;
  const height = box.height * scale;

  return {
    eased,
    box: {
      px: cx - width / 2,
      py: cy + dy - height / 2,
      width,
      height,
    },
  };
}

export const REVEAL_TEXT = 'vann iri';

// ------------------------------------------------- highlight pulse (Part A)

/** Period of the breathing pulse on the selected chair. */
export const PULSE_PERIOD_MS = 760;

/** Peak extra scale at the top of the pulse. */
export const PULSE_SCALE_AMOUNT = 0.055;

/** How often a shockwave ring emanates from the selected chair. */
export const SHOCKWAVE_PERIOD_MS = 1150;

/**
 * Breathing oscillator, 0..1, sinusoidal.
 *
 * Returned as a unit value rather than a scale factor so callers can drive
 * opacity, radius and scale from one phase and keep them visually in sync.
 */
export function pulseUnit(nowMs: number, periodMs = PULSE_PERIOD_MS): number {
  return 0.5 + 0.5 * Math.sin((nowMs / periodMs) * Math.PI * 2);
}

/** Scale multiplier for the breathing highlight. */
export function pulseScale(nowMs: number, amount = PULSE_SCALE_AMOUNT): number {
  return 1 + amount * pulseUnit(nowMs);
}

/**
 * Shockwave progress, 0..1, sawtooth — expands outward then restarts.
 * Repeating rather than one-shot because it is what keeps the eye pulled back to
 * the winning chair after the initial reveal has settled.
 */
export function shockwavePhase(nowMs: number, periodMs = SHOCKWAVE_PERIOD_MS): number {
  const p = (nowMs % periodMs) / periodMs;
  return p < 0 ? p + 1 : p;
}

// ------------------------------------------------------- caption (Part B)

/** Caption waits this long after the chair highlight, so the two read as a sequence. */
export const CAPTION_DELAY_MS = 180;

/** Caption animation length. Short, and it settles — no looping distraction. */
export const CAPTION_MS = 620;

/** Peak wiggle, radians. */
export const CAPTION_WIGGLE_RAD = 0.1;

/** Overshoot constant for easeOutBack. Higher = bigger bounce past 1. */
export const CAPTION_OVERSHOOT = 1.7;

/**
 * easeOutBack — overshoots past 1 then settles back.
 *
 * This is what makes the caption *pop* instead of merely appearing: scale runs
 * 0 → ~1.1 → 1. Standard formulation, with the overshoot amount exposed.
 */
export function easeOutBack(t: number, overshoot = CAPTION_OVERSHOOT): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  const c3 = overshoot + 1;
  return 1 + c3 * Math.pow(c - 1, 3) + overshoot * Math.pow(c - 1, 2);
}

export interface CaptionTransform {
  /** False before the staggered start — caller draws nothing. */
  visible: boolean;
  progress: number;
  scale: number;
  /** Radians. Damps to zero as the animation settles. */
  rotation: number;
  alpha: number;
}

/**
 * Caption pop-in.
 *
 * `elapsedMs` is measured from the start of the reveal, not from the caption's
 * own start, so the caller does not have to track the stagger separately.
 *
 * The wiggle is multiplied by (1 - progress) so it damps out rather than ending
 * abruptly mid-swing, and lands at exactly zero rotation.
 */
export function captionTransform(elapsedMs: number): CaptionTransform {
  const local = elapsedMs - CAPTION_DELAY_MS;
  if (local < 0) {
    return { visible: false, progress: 0, scale: 0, rotation: 0, alpha: 0 };
  }

  const progress = Math.min(1, local / CAPTION_MS);

  return {
    visible: true,
    progress,
    scale: easeOutBack(progress),
    rotation: CAPTION_WIGGLE_RAD * Math.sin(progress * Math.PI * 5) * (1 - progress),
    // Fades in over the first fifth so it does not blink into existence at
    // scale 0, which reads as a glitch rather than a pop.
    alpha: Math.min(1, progress / 0.2),
  };
}
