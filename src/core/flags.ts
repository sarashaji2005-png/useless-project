/**
 * Feature flags.
 *
 * ENABLE_FLOOR_CALIBRATION — the optional stretch path from the earlier design.
 *
 * When off (the default, and the only tested configuration), all visibility
 * math happens in screen space against raw pixel coordinates. No calibration
 * step, no homography, nothing to get wrong on stage.
 *
 * When on, it would add a one-time 4-point floor click to recover real-world
 * distances, enabling the anthropometric sightline model: seated head height as
 * `0.53 × heightCm + chairHeight`, compared against a teacher eye-height
 * sightline interpolated along the ray. That is a strictly more accurate
 * occlusion model, because it reasons about whether a blocker's head actually
 * rises above the line of sight rather than using frame position as a depth
 * proxy.
 *
 * STATUS: NOT BUILT. The flag exists so the screen-space path is structurally
 * the default rather than a fallback, and so the supporting modules
 * (core/homography.ts, core/heightEstimator.ts, core/visibilityEngine.ts) are
 * kept as deliberate groundwork rather than looking like dead code. Turning
 * this on today does nothing.
 */
export const ENABLE_FLOOR_CALIBRATION = false;
