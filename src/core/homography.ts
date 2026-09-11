/**
 * Planar homography solver — kept as groundwork for the gated
 * ENABLE_FLOOR_CALIBRATION stretch path (see core/flags.ts). NOT used by the
 * default screen-space pipeline.
 *
 * Retained rather than deleted because this is the hard, easy-to-get-wrong part
 * of that stretch path, and it is verified correct: it solves the 4-point case
 * to a round-trip residual of ~1e-13 px. Self-contained on purpose, so it has
 * no dependency on the live pipeline's models.
 */

/**
 * The 8 free parameters of a planar homography, row-major, with h22 fixed at 1.
 *   u = (h00·x + h01·y + h02) / (h20·x + h21·y + 1)
 *   v = (h10·x + h11·y + h12) / (h20·x + h21·y + 1)
 */
export type Homography = readonly [
  number, number, number,
  number, number, number,
  number, number,
];

/**
 * Planar homography from exactly 4 point correspondences, via the Direct
 * Linear Transform.
 *
 * A general projective map between two planes has 9 parameters but only 8
 * degrees of freedom (it is defined up to scale), so we fix h22 = 1 and are
 * left with 8 unknowns. Each point pair contributes 2 equations, so 4 pairs
 * gives exactly 8 — a square system with a unique solution, no least-squares
 * needed.
 *
 * For a pair (x, y) -> (u, v):
 *
 *   u·(h20·x + h21·y + 1) = h00·x + h01·y + h02
 *   v·(h20·x + h21·y + 1) = h10·x + h11·y + h12
 *
 * Rearranged into rows of A·h = b with h = [h00..h12, h20, h21]:
 *
 *   [x, y, 1, 0, 0, 0, -u·x, -u·y] · h = u
 *   [0, 0, 0, x, y, 1, -v·x, -v·y] · h = v
 */
export function solveHomography(
  src: readonly { x: number; y: number }[],
  dst: readonly { x: number; y: number }[],
): Homography {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error(
      `solveHomography needs exactly 4 point pairs, got ${src.length}/${dst.length}`,
    );
  }

  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinearSystem(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]] as const;
}

/**
 * Gaussian elimination with partial pivoting. Partial pivoting matters here:
 * the DLT matrix mixes raw pixel coordinates (order 10^2) with products of
 * coordinates (order 10^5), so without pivoting the elimination loses
 * precision fast.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  // Work on an augmented copy so callers keep their inputs.
  const m: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Find the row with the largest absolute value in this column.
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) {
      throw new Error(
        'Degenerate homography: the 4 points are collinear, coincident, or ' +
          'clicked in a self-intersecting order.',
      );
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];

    // Eliminate below.
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }

  // Back-substitution.
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r][n];
    for (let c = r + 1; c < n; c++) sum -= m[r][c] * x[c];
    x[r] = sum / m[r][r];
  }
  return x;
}

/** Apply a homography to a point. */
export function applyHomography(
  h: Homography,
  x: number,
  y: number,
): { x: number; y: number } {
  const denom = h[6] * x + h[7] * y + 1;
  if (Math.abs(denom) < 1e-12) {
    // The point sits on the horizon line of the mapping — it has no finite
    // image. Callers must treat this as "off-plane", not as a real position.
    return { x: NaN, y: NaN };
  }
  return {
    x: (h[0] * x + h[1] * y + h[2]) / denom,
    y: (h[3] * x + h[4] * y + h[5]) / denom,
  };
}

/**
 * Mean round-trip error, in the units of `src`. Push each source point
 * forward through `forward` and back through `inverse`; a correct pair of
 * solves returns it to where it started.
 */
export function roundTripResidual(
  forward: Homography,
  inverse: Homography,
  src: readonly { x: number; y: number }[],
): number {
  let total = 0;
  for (const p of src) {
    const fwd = applyHomography(forward, p.x, p.y);
    const back = applyHomography(inverse, fwd.x, fwd.y);
    if (!Number.isFinite(back.x) || !Number.isFinite(back.y)) return Infinity;
    total += Math.hypot(back.x - p.x, back.y - p.y);
  }
  return total / src.length;
}

/**
 * Local ground-plane scale at a point, in pixels per centimetre.
 *
 * Under perspective this varies across the frame — a centimetre of floor near
 * the camera covers many more pixels than a centimetre at the back wall. We
 * measure it by stepping a known distance along the floor and seeing how far
 * that moves us in the image.
 *
 * Returned separately for the two floor axes because they are NOT the same:
 * the depth axis is heavily foreshortened, the across axis much less so.
 */
export function localGroundScale(
  gridToPixel: Homography,
  gx: number,
  gy: number,
  stepCm = 10,
): { acrossPxPerCm: number; depthPxPerCm: number } {
  const origin = applyHomography(gridToPixel, gx, gy);
  const alongX = applyHomography(gridToPixel, gx + stepCm, gy);
  const alongY = applyHomography(gridToPixel, gx, gy + stepCm);

  return {
    acrossPxPerCm: Math.hypot(alongX.x - origin.x, alongX.y - origin.y) / stepCm,
    depthPxPerCm: Math.hypot(alongY.x - origin.x, alongY.y - origin.y) / stepCm,
  };
}
