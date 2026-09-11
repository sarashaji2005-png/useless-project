/**
 * Icon set: eye, hat, chair, blip, radar.
 *
 * Hand-drawn SVG paths rather than an icon library — five simple glyphs is not
 * worth a dependency, and these need to sit on a 24-unit grid so they tile
 * cleanly in the scattered background pattern.
 *
 * All use `currentColor` so a single fill on the parent recolours them.
 */

export type GlyphName = 'eye' | 'hat' | 'chair' | 'blip' | 'radar';

interface Props {
  name: GlyphName;
  size?: number;
  className?: string;
}

export function Glyph({ name, size = 24, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <GlyphPath name={name} />
    </svg>
  );
}

export function GlyphPath({ name }: { name: GlyphName }) {
  switch (name) {
    case 'eye':
      return (
        <>
          <path d="M1.8 12S5.5 5.6 12 5.6 22.2 12 22.2 12 18.5 18.4 12 18.4 1.8 12 1.8 12Z" />
          <circle cx="12" cy="12" r="3.1" />
        </>
      );
    case 'hat':
      // Graduation cap: mortarboard plus tassel.
      return (
        <>
          <path d="M2.2 9.1 12 4.9l9.8 4.2L12 13.3 2.2 9.1Z" />
          <path d="M5.6 10.7v4.4c0 1.6 2.9 3 6.4 3s6.4-1.4 6.4-3v-4.4" />
          <path d="M21.8 9.1v5" />
        </>
      );
    case 'chair':
      return (
        <>
          <path d="M7 3.4h10v8.2H7z" />
          <path d="M6 11.6h12" />
          <path d="M7.6 11.6v6.4M16.4 11.6v6.4" />
          <path d="M7.6 20.6v-2.6h8.8v2.6" />
        </>
      );
    case 'blip':
      return (
        <>
          <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="6" opacity="0.55" />
          <circle cx="12" cy="12" r="9.6" opacity="0.28" />
        </>
      );
    case 'radar':
      return (
        <>
          <circle cx="12" cy="12" r="9.4" />
          <circle cx="12" cy="12" r="4.6" opacity="0.5" />
          <path d="M12 12 19.2 6.4" />
          <circle cx="16.4" cy="8.6" r="1.5" fill="currentColor" stroke="none" />
        </>
      );
  }
}
