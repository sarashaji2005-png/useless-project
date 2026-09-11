/**
 * Deterministic pseudo-random numbers.
 *
 * Two separate needs, deliberately kept distinct:
 *
 *  - SEEDED randomness, for the per-day luck factor. The same seat must get the
 *    same luck all day and a different one tomorrow. Reproducible by design.
 *  - UNSEEDED randomness, for the actual draw. Two draws in the same session
 *    must be able to differ, otherwise the roulette wheel is theatre.
 *
 * Math.random cannot do the first job (no seeding) and is fine for the second.
 */

/**
 * xmur3 string hash. Produces a well-mixed 32-bit seed from a string.
 *
 * A naive `charCodeAt` sum would leave similar seat ids ('SEAT-001',
 * 'SEAT-002') with adjacent seeds, and adjacent seeds in a weak PRNG give
 * visibly correlated first outputs — neighbouring seats would get near-identical
 * "luck", which defeats the point.
 */
export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32. Small, fast, and statistically decent for this purpose. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded generator from any string. */
export function seededRandom(seedString: string): () => number {
  return mulberry32(xmur3(seedString)());
}

/** One stable value in [0, 1) for a given string. */
export function hashToUnit(seedString: string): number {
  return seededRandom(seedString)();
}

/**
 * Local calendar date as YYYY-MM-DD, used as the luck epoch.
 *
 * Local rather than UTC on purpose: "today's luck" should change at local
 * midnight, not at whatever hour UTC rolls over for the user.
 */
export function dateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
