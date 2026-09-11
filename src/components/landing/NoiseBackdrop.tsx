import { useMemo } from 'react';
import { GlyphPath, type GlyphName } from './Glyph';
import { palette, withAlpha } from '../../design/tokens';
import { seededRandom } from '../../core/prng';

/**
 * The busy backdrop: grid, scattered iconography, and soft colour blobs.
 *
 * Three things keep density from becoming chaos:
 *
 *  1. Everything here is LOW OPACITY (grid ~4%, glyphs 5-11%). The noise has to
 *     sit clearly behind content, not compete with it. This is the whole reason a
 *     maximalist layout can still have an obvious focal point.
 *  2. Positions come from a SEEDED generator, so the scatter is identical on
 *     every render and reload. Math.random would reshuffle on every re-render and
 *     make the page feel unstable.
 *  3. `aria-hidden` throughout — it is decoration, and a screen reader
 *     announcing forty scattered icons would be actively hostile.
 */

const SCATTER_SEED = 'hidenseat/backdrop/v1';
const GLYPH_COUNT = 46;
const GLYPHS: GlyphName[] = ['eye', 'hat', 'chair', 'blip', 'radar'];

interface ScatterItem {
  name: GlyphName;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  colour: string;
  opacity: number;
}

export function NoiseBackdrop() {
  const items = useMemo<ScatterItem[]>(() => {
    const rng = seededRandom(SCATTER_SEED);
    const tints = [palette.amber, palette.playful, palette.yellow, palette.green, palette.violet];
    const out: ScatterItem[] = [];

    for (let i = 0; i < GLYPH_COUNT; i++) {
      out.push({
        name: GLYPHS[Math.floor(rng() * GLYPHS.length)],
        x: rng() * 100,
        y: rng() * 100,
        scale: 0.75 + rng() * 1.9,
        rotate: (rng() - 0.5) * 60,
        colour: tints[Math.floor(rng() * tints.length)],
        opacity: 0.05 + rng() * 0.06,
      });
    }
    return out;
  }, []);

  return (
    <div className="hns-backdrop" aria-hidden="true">
      {/* Soft colour blobs. Blurred and heavily transparent so they read as
          lighting on the surface rather than as shapes competing for attention. */}
      <div className="hns-blob hns-blob--1" />
      <div className="hns-blob hns-blob--2" />
      <div className="hns-blob hns-blob--3" />

      <svg className="hns-backdrop__svg" preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <pattern id="hns-grid" width="4" height="4" patternUnits="userSpaceOnUse">
            <path
              d="M4 0H0V4"
              fill="none"
              stroke={withAlpha(palette.amber, 0.055)}
              strokeWidth="0.12"
            />
          </pattern>
          <pattern id="hns-grid-coarse" width="20" height="20" patternUnits="userSpaceOnUse">
            <path
              d="M20 0H0V20"
              fill="none"
              stroke={withAlpha(palette.amber, 0.09)}
              strokeWidth="0.16"
            />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#hns-grid)" />
        <rect width="100" height="100" fill="url(#hns-grid-coarse)" />
      </svg>

      {/* Scattered glyphs, positioned in percentages so they spread with the
          viewport instead of clustering at the top on a tall screen. */}
      <div className="hns-scatter">
        {items.map((it, i) => (
          <svg
            key={i}
            className="hns-scatter__item"
            style={{
              left: `${it.x}%`,
              top: `${it.y}%`,
              color: it.colour,
              opacity: it.opacity,
              transform: `translate(-50%, -50%) rotate(${it.rotate}deg) scale(${it.scale})`,
            }}
            width={28}
            height={28}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <GlyphPath name={it.name} />
          </svg>
        ))}
      </div>
    </div>
  );
}
