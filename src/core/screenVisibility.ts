import {
  angularInterval,
  angularOverlapFraction,
  boxBottom,
  centroid,
  clamp01,
  distance,
  intervalOverlapFraction,
  normaliseAngle,
  segmentBoxIntersection,
} from './geometry2d';
import { combineObstructions, coneScore } from './scoring';
import type {
  BlockerContribution,
  Occupant,
  Point,
  SeatRuntimeState,
  Track,
} from '../models/types';

// ===========================================================================
// VISIBILITY CONSTANTS
// ===========================================================================

// FOV_CONE_DEG and SIGHT_RADIUS_FRAC moved to core/roomConfig, which is now the
// single place room geometry is tuned.
//
// Imported AND re-exported, deliberately: a bare `export { x } from './y'` does
// not create a local binding, so the defaults further down this file
// (`coneDeg = FOV_CONE_DEG`) could not see it. The duplicate local
// `SIGHT_RADIUS_FRAC` that used to sit here has been removed — it was shadowing
// the re-export and was the actual redeclaration error.
import { FOV_CONE_DEG, SIGHT_RADIUS_FRAC } from './roomConfig';

export { FOV_CONE_DEG, SIGHT_RADIUS_FRAC };

/**
 * Depth-proxy margin, as a fraction of the target chair's box height.
 *
 * A blocker must sit at least this much lower in frame than the target before
 * it counts as being in front. Without the margin, two chairs in the same row
 * at near-identical depth flicker in and out of blocking each other.
 */
export const DEPTH_MARGIN_FRAC = 0.15;

/** Obstruction above this draws a leader line to the dominant blocker. */
export const LEADER_LINE_THRESHOLD = 0.15;

// ===========================================================================

export interface VisibilityInput {
  teacherPoint: Point;
  /**
   * Facing direction in degrees. If omitted it is inferred from the mean chair
   * position — a teacher faces the class.
   */
  facingDeg?: number;
  chairs: readonly Track[];
  people: readonly Track[];
  occupantsByChair: ReadonlyMap<string, Occupant>;
  frameWidth: number;
  frameHeight: number;
  coneDeg?: number;
  /**
   * Sight radius in pixels. Defaults to frame diagonal × SIGHT_RADIUS_FRAC.
   *
   * Exposed as an override because the default is deliberately generous — at
   * 1.0 the whole frame sits inside sight range, so distance barely bites and
   * the off-axis angle dominates the score. A tighter radius makes distance the
   * primary factor, which is what makes back rows read as safer than front ones.
   */
  radiusPx?: number;
}

/**
 * Infer where the teacher is looking.
 *
 * The spec gives us one click, which fixes the cone's apex but not its
 * direction. Rather than demand a second click, we point the cone at the
 * centroid of all detected chairs: a teacher addressing a room faces the room.
 * It is an assumption, but a defensible one, and it degrades gracefully — with
 * no chairs detected we fall back to facing down-frame.
 */
export function inferFacingDeg(
  teacherPoint: Point,
  chairs: readonly Track[],
): number {
  if (chairs.length === 0) return 90; // +y, into the frame

  let sx = 0;
  let sy = 0;
  for (const c of chairs) {
    sx += c.centroid.x;
    sy += c.centroid.y;
  }
  const mean = { x: sx / chairs.length, y: sy / chairs.length };

  const dx = mean.x - teacherPoint.x;
  const dy = mean.y - teacherPoint.y;
  if (Math.hypot(dx, dy) < 1e-6) return 90;

  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * Score every tracked chair in pixel space.
 *
 * For each chair:
 *   1. base score from angle off the cone centre and distance from the apex,
 *      using the SAME shared coneScore as the grid-space engine
 *   2. occlusion from every other tracked box the sightline passes through,
 *      that is plausibly nearer the camera than the target
 *   3. penalties stacked as 1 - product(1 - oᵢ)
 */
export function computeScreenVisibility(input: VisibilityInput): SeatRuntimeState[] {
  const {
    teacherPoint,
    chairs,
    people,
    occupantsByChair,
    frameWidth,
    frameHeight,
    coneDeg = FOV_CONE_DEG,
  } = input;

  const facingDeg = input.facingDeg ?? inferFacingDeg(teacherPoint, chairs);
  const radiusPx =
    input.radiusPx ?? Math.hypot(frameWidth, frameHeight) * SIGHT_RADIUS_FRAC;
  const halfCone = coneDeg / 2;

  const allTracks: Track[] = [...chairs, ...people];
  const states: SeatRuntimeState[] = [];

  for (const chair of chairs) {
    const target = chair.centroid;
    const dx = target.x - teacherPoint.x;
    const dy = target.y - teacherPoint.y;
    const distancePx = Math.hypot(dx, dy);
    const bearingDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const offAxisDeg = Math.abs(normaliseAngle(bearingDeg - facingDeg));

    const base = coneScore({ offAxisDeg, halfConeDeg: halfCone, distance: distancePx, radius: radiusPx });
    const baseScore = base.factor * 100;

    const occupant = occupantsByChair.get(chair.id);

    // A chair outside the cone is already invisible; skip the occlusion work.
    if (base.outside || baseScore <= 0) {
      states.push({
        seatId: chair.id,
        visibilityScore: 0,
        baseScore: 0,
        obstruction: 0,
        blockers: [],
        offAxisDeg,
        distancePx,
        occupied: occupant !== undefined,
      });
      continue;
    }

    const targetAngular = angularInterval(teacherPoint, chair.box);
    const targetBottom = boxBottom(chair.box);
    const depthMargin = chair.box.height * DEPTH_MARGIN_FRAC;

    const blockers: BlockerContribution[] = [];

    for (const other of allTracks) {
      if (other.id === chair.id) continue;

      // The person sitting ON this chair is not blocking the view OF this
      // chair — they are what the teacher would be looking at. Without this
      // exclusion every occupied seat occludes itself.
      if (occupant?.personTrackId === other.id) continue;

      // Does the sightline actually pass through this box?
      const hit = segmentBoxIntersection(teacherPoint, target, other.box);
      if (!hit) continue;
      if (hit.tExit <= 0 || hit.tEnter >= 1) continue;

      // DEPTH PROXY: lower in frame implies nearer the camera in a typical
      // classroom shot. A box that is HIGHER in frame than the target is
      // further away, so it sits behind the target and cannot block it.
      //
      // Caveat worth stating: this is camera-relative depth used as a stand-in
      // for teacher-relative depth. It holds when the teacher is near the
      // camera, i.e. both at the front of the room, which is the normal setup.
      // A camera at the BACK of the room inverts the relationship and this test
      // becomes wrong.
      if (boxBottom(other.box) <= targetBottom + depthMargin) continue;

      // How much of the target's angular extent this blocker covers, as seen
      // from the teacher. Angular rather than raw pixel width, so a blocker
      // close to the teacher correctly blocks more than a distant one.
      const blockerAngular = angularInterval(teacherPoint, other.box);
      const lateralCoverage = angularOverlapFraction(targetAngular, blockerAngular);
      if (lateralCoverage <= 0) continue;

      // How much of the target's vertical extent the blocker spans in frame.
      // A low backrest in front covers less of you than a tall person does.
      const verticalCoverage = intervalOverlapFraction(
        chair.box.py,
        targetBottom,
        other.box.py,
        boxBottom(other.box),
      );
      if (verticalCoverage <= 0) continue;

      const obstruction = clamp01(lateralCoverage * verticalCoverage);
      if (obstruction <= 0.001) continue;

      blockers.push({
        trackId: other.id,
        cls: other.cls,
        obstruction,
        t: clamp01((hit.tEnter + hit.tExit) / 2),
      });
    }

    blockers.sort((a, b) => b.obstruction - a.obstruction);
    const obstruction = combineObstructions(blockers.map((b) => b.obstruction));
    const visibilityScore = baseScore * (1 - obstruction);

    states.push({
      seatId: chair.id,
      visibilityScore,
      // Only report a source when the penalty is actually meaningful; a 2%
      // graze is noise and drawing a leader line for it just adds clutter.
      occlusionSource:
        blockers.length > 0 && blockers[0].obstruction >= LEADER_LINE_THRESHOLD
          ? blockers[0].trackId
          : undefined,
      baseScore,
      obstruction,
      blockers,
      offAxisDeg,
      distancePx,
      occupied: occupant !== undefined,
    });
  }

  return states;
}

/** Cone edge endpoints, for drawing. */
export function coneEdges(
  teacherPoint: Point,
  facingDeg: number,
  radiusPx: number,
  coneDeg = FOV_CONE_DEG,
): [Point, Point] {
  const half = coneDeg / 2;
  const at = (deg: number): Point => {
    const r = (deg * Math.PI) / 180;
    return {
      x: teacherPoint.x + Math.cos(r) * radiusPx,
      y: teacherPoint.y + Math.sin(r) * radiusPx,
    };
  };
  return [at(facingDeg - half), at(facingDeg + half)];
}

export { distance, centroid };
