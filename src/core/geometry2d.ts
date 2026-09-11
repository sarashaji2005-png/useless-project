import type { Box, Point } from '../models/types';

/** Centre of a box. */
export function centroid(b: Box): Point {
  return { x: b.px + b.width / 2, y: b.py + b.height / 2 };
}

export function boxRight(b: Box): number {
  return b.px + b.width;
}

export function boxBottom(b: Box): number {
  return b.py + b.height;
}

export function boxArea(b: Box): number {
  return Math.max(0, b.width) * Math.max(0, b.height);
}

/** The four corners, clockwise from top-left. */
export function boxCorners(b: Box): Point[] {
  return [
    { x: b.px, y: b.py },
    { x: boxRight(b), y: b.py },
    { x: boxRight(b), y: boxBottom(b) },
    { x: b.px, y: boxBottom(b) },
  ];
}

/** Intersection-over-union. 0 when disjoint, 1 when identical. */
export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.px, b.px);
  const y1 = Math.max(a.py, b.py);
  const x2 = Math.min(boxRight(a), boxRight(b));
  const y2 = Math.min(boxBottom(a), boxBottom(b));

  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return 0;

  const inter = w * h;
  const union = boxArea(a) + boxArea(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Overlap of two 1D intervals, as a fraction of the FIRST interval's length. */
export function intervalOverlapFraction(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
): number {
  const len = aMax - aMin;
  if (len <= 0) return 0;
  const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  return overlap <= 0 ? 0 : Math.min(1, overlap / len);
}

export function pointInBox(p: Point, b: Box, margin = 0): boolean {
  return (
    p.x >= b.px - margin &&
    p.x <= boxRight(b) + margin &&
    p.y >= b.py - margin &&
    p.y <= boxBottom(b) + margin
  );
}

/**
 * Segment vs axis-aligned box intersection, via the slab method.
 *
 * Returns the entry and exit parameters along the segment (t in 0..1), or null
 * if the segment misses the box entirely. This is the standard Cyrus-Beck /
 * Liang-Barsky style clip: for each axis, the segment is inside the box's slab
 * over some t-interval, and the intersection of those intervals is where it is
 * inside the box on both axes at once.
 *
 * No ray marching, no sampling — one exact interval per axis.
 */
export function segmentBoxIntersection(
  from: Point,
  to: Point,
  box: Box,
): { tEnter: number; tExit: number } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  let tEnter = 0;
  let tExit = 1;

  // X slab.
  if (Math.abs(dx) < 1e-9) {
    // Segment is vertical: it can only hit the box if it already lies within
    // the box's x-range.
    if (from.x < box.px || from.x > boxRight(box)) return null;
  } else {
    let t1 = (box.px - from.x) / dx;
    let t2 = (boxRight(box) - from.x) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tEnter = Math.max(tEnter, t1);
    tExit = Math.min(tExit, t2);
    if (tEnter > tExit) return null;
  }

  // Y slab.
  if (Math.abs(dy) < 1e-9) {
    if (from.y < box.py || from.y > boxBottom(box)) return null;
  } else {
    let t1 = (box.py - from.y) / dy;
    let t2 = (boxBottom(box) - from.y) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tEnter = Math.max(tEnter, t1);
    tExit = Math.min(tExit, t2);
    if (tEnter > tExit) return null;
  }

  if (tExit < 0 || tEnter > 1) return null;
  return { tEnter, tExit };
}

/**
 * Angular extent of a box as seen from a viewpoint.
 *
 * Returned relative to the bearing of the box centre, which sidesteps the
 * ±180° wraparound problem entirely: instead of absolute angles that can
 * straddle the discontinuity, we carry a centre bearing plus a symmetric-ish
 * offset range around it.
 */
export interface AngularInterval {
  /** Bearing to the box centre, degrees. */
  centreDeg: number;
  /** Most negative corner offset from centreDeg, degrees. */
  minOffsetDeg: number;
  /** Most positive corner offset from centreDeg, degrees. */
  maxOffsetDeg: number;
}

export function angularInterval(from: Point, box: Box): AngularInterval {
  const c = centroid(box);
  const centreDeg = (Math.atan2(c.y - from.y, c.x - from.x) * 180) / Math.PI;

  let minOffsetDeg = 0;
  let maxOffsetDeg = 0;
  for (const corner of boxCorners(box)) {
    const deg = (Math.atan2(corner.y - from.y, corner.x - from.x) * 180) / Math.PI;
    const offset = normaliseAngle(deg - centreDeg);
    if (offset < minOffsetDeg) minOffsetDeg = offset;
    if (offset > maxOffsetDeg) maxOffsetDeg = offset;
  }

  return { centreDeg, minOffsetDeg, maxOffsetDeg };
}

export function angularWidth(interval: AngularInterval): number {
  return interval.maxOffsetDeg - interval.minOffsetDeg;
}

/**
 * How much of `target`'s angular extent is covered by `blocker`'s, as a
 * fraction of the target's width.
 *
 * Both intervals are re-expressed relative to the target's centre bearing so
 * they can be compared on one axis without wraparound trouble.
 */
export function angularOverlapFraction(
  target: AngularInterval,
  blocker: AngularInterval,
): number {
  const shift = normaliseAngle(blocker.centreDeg - target.centreDeg);
  const bMin = shift + blocker.minOffsetDeg;
  const bMax = shift + blocker.maxOffsetDeg;
  return intervalOverlapFraction(
    target.minOffsetDeg,
    target.maxOffsetDeg,
    bMin,
    bMax,
  );
}

/** Wrap to (-180, 180]. */
export function normaliseAngle(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
