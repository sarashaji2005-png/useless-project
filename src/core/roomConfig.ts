import type { Point } from '../models/types';

/**
 * Room geometry — the single place the classroom's fixed assumptions are tuned.
 *
 * RECONSTRUCTED. This module was referenced by useScanEngine.ts and
 * screenVisibility.ts but was missing from disk, which is what broke the build.
 * Nothing here is invented: every export is pinned by an existing call site, and
 * the values match what these constants were before they were moved out of
 * screenVisibility.ts, so behaviour is unchanged.
 */

/**
 * Total field-of-view cone width in degrees, centred on the facing direction.
 *
 * Used as the default `coneDeg` in computeScreenVisibility.
 */
export const FOV_CONE_DEG = 120;

/**
 * Sight radius as a fraction of the frame diagonal.
 *
 * 1.0 means the far corner of the frame sits exactly at the edge of sight, so
 * nothing in view is ever zeroed purely on distance.
 *
 * KNOWN SENSITIVITY: at 1.0 the distance term barely bites and the off-axis angle
 * dominates, so an on-axis seat at the back of the room can outscore a closer one
 * off to the side. Lowering this makes distance the primary factor and the back
 * rows read as safer. There are two assertions in scripts/verifyRounds.ts that
 * demonstrate the inversion in both directions.
 */
export const SIGHT_RADIUS_FRAC = 1.0;

/**
 * Where the front of the room sits, as a fraction of frame width and height.
 *
 * Bottom-centre, because the camera is assumed to be at the front of the room
 * looking back over the seats. That puts the front of the room at the BOTTOM of
 * the frame (large y) and the back at the top — the same convention the occlusion
 * depth proxy relies on, where lower in frame means nearer the camera.
 *
 * Just inside the bottom edge rather than exactly on it, so the point is never
 * degenerate with a chair box sitting flush against the frame border.
 */
export const ROOM_REFERENCE_X_FRAC = 0.5;
export const ROOM_REFERENCE_Y_FRAC = 0.98;

/**
 * The fixed front-of-room reference point, in frame pixels.
 *
 * Replaces the manual teacher click. Derived from frame size rather than stored,
 * so it lands in the same relative spot at any camera resolution and cannot go
 * stale when the resolution changes mid-session.
 */
export function roomReferencePoint(frameWidth: number, frameHeight: number): Point {
  return {
    x: frameWidth * ROOM_REFERENCE_X_FRAC,
    y: frameHeight * ROOM_REFERENCE_Y_FRAC,
  };
}
