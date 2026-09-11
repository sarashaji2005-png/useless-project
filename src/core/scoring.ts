import { clamp01 } from './geometry2d';

/**
 * The incidence + distance falloff core, extracted from the original
 * grid-space visibilityEngine so BOTH paths use one implementation:
 *
 *   - the screen-space engine (default), fed pixel distances
 *   - the gated floor-calibration engine (stretch), fed centimetres
 *
 * The function is unit-agnostic on purpose. It only ever compares a distance
 * to a radius and an angle to a half-cone, so whether those are pixels or
 * centimetres is the caller's business. Keeping it shared means the two paths
 * cannot drift apart in how they weight attention.
 */

export interface ConeScoreInput {
  /** Absolute angular offset from the centre of the cone, degrees. */
  offAxisDeg: number;
  /** Half the cone's total width, degrees. */
  halfConeDeg: number;
  /** Distance from apex to target, in whatever unit `radius` uses. */
  distance: number;
  /** Maximum sight distance. Beyond this, score is zero. */
  radius: number;
}

export interface ConeScore {
  /** 0-1 product of the two factors. */
  factor: number;
  incidenceFactor: number;
  distanceFactor: number;
  /** True when the target is outside the cone or beyond the radius. */
  outside: boolean;
}

/** Exponent on the distance ratio. >1 keeps mid-range targets from feeling safe. */
export const DISTANCE_FALLOFF_EXPONENT = 1.6;

export function coneScore({
  offAxisDeg,
  halfConeDeg,
  distance,
  radius,
}: ConeScoreInput): ConeScore {
  const outside = offAxisDeg > halfConeDeg || distance > radius;
  if (outside || halfConeDeg <= 0 || radius <= 0) {
    return { factor: 0, incidenceFactor: 0, distanceFactor: 0, outside: true };
  }

  // Cosine falloff across the cone: 1 dead centre, 0 at the edge. Cosine
  // rather than linear because peripheral attention drops off faster than the
  // angle does.
  const incidenceFactor = Math.cos((offAxisDeg / halfConeDeg) * (Math.PI / 2));

  const distanceFactor =
    1 - Math.pow(distance / radius, DISTANCE_FALLOFF_EXPONENT);

  return {
    factor: clamp01(incidenceFactor * clamp01(distanceFactor)),
    incidenceFactor,
    distanceFactor: clamp01(distanceFactor),
    outside: false,
  };
}

/**
 * Combine independent partial blockers.
 *
 * `1 - Π(1 - oᵢ)` treats each blocker as covering an independent fraction of
 * the sightline, so two half-blockers stack to 75% rather than one silently
 * overwriting the other. Order-independent, and it can never exceed 1.
 */
export function combineObstructions(obstructions: readonly number[]): number {
  let pass = 1;
  for (const o of obstructions) pass *= 1 - clamp01(o);
  return clamp01(1 - pass);
}
