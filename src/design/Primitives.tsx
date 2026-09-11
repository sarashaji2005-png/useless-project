import type { ReactNode } from 'react';
import type { AccentName } from './tokens';

/**
 * Reusable primitives for the shared design system.
 *
 * These exist so no screen hardcodes a colour or a shadow. Accent selection is a
 * prop, resolved to a CSS class that sets the `--a` custom property trio, and
 * every visual treatment reads from that. Adding a sixth accent later means
 * touching the token file and one CSS block, not every call site.
 */

const accentClass: Record<AccentName | 'red', string> = {
  amber: 'hns-amber',
  coral: 'hns-coral',
  yellow: 'hns-yellow',
  green: 'hns-green',
  violet: 'hns-violet',
  red: 'hns-red',
};

export type Tone = AccentName | 'red';

// ------------------------------------------------------------------ button

interface ButtonProps {
  children: ReactNode;
  tone?: Tone;
  /** Solid fill. Use for the single most important action on a view. */
  solid?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}

export function LoudButton({
  children,
  tone = 'amber',
  solid = false,
  size = 'md',
  onClick,
  disabled,
  title,
}: ButtonProps) {
  const classes = [
    'hns-btn',
    accentClass[tone],
    solid ? 'hns-btn--solid' : '',
    size === 'lg' ? 'hns-btn--lg' : size === 'sm' ? 'hns-btn--sm' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

// ----------------------------------------------------------------- sticker

interface StickerProps {
  children: ReactNode;
  tone?: Tone;
  /** Degrees. Varied per instance on purpose — uniform tilt looks like a bug. */
  rotate?: number;
  ghost?: boolean;
}

export function Sticker({ children, tone = 'yellow', rotate = -3, ghost }: StickerProps) {
  return (
    <span
      className={`hns-sticker ${accentClass[tone]} ${ghost ? 'hns-sticker--ghost' : ''}`}
      style={{ ['--rot' as string]: `${rotate}deg` }}
    >
      {children}
    </span>
  );
}

// -------------------------------------------------------------------- card

interface CardProps {
  title: string;
  children: ReactNode;
  tone?: Tone;
  badge?: string;
  badgeRotate?: number;
  icon?: ReactNode;
}

export function LoudCard({
  title,
  children,
  tone = 'amber',
  badge,
  badgeRotate = 4,
  icon,
}: CardProps) {
  return (
    <article className={`hns-card ${accentClass[tone]}`}>
      {badge && (
        <span className="hns-card__badge">
          <Sticker tone={tone} rotate={badgeRotate}>
            {badge}
          </Sticker>
        </span>
      )}
      {icon}
      <h3 className="hns-card__title">{title}</h3>
      <p className="hns-card__body">{children}</p>
    </article>
  );
}

// -------------------------------------------------------------------- step

interface StepProps {
  n: number;
  title: string;
  children: ReactNode;
  tone?: Tone;
  rotate?: number;
}

export function Step({ n, title, children, tone = 'amber', rotate = -2 }: StepProps) {
  return (
    <div className="hns-step">
      <div
        className={`hns-step__num ${accentClass[tone]}`}
        style={{ ['--rot' as string]: `${rotate}deg` }}
        aria-hidden="true"
      >
        {n}
      </div>
      <div>
        <h4 className="hns-step__title">{title}</h4>
        <p className="hns-step__body">{children}</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ ticker

interface TickerProps {
  items: string[];
  tone?: Tone;
}

/**
 * Scrolling strip. Content is rendered twice and translated -50%, which is what
 * makes the loop seamless — a single copy would visibly snap back to the start.
 */
export function Ticker({ items, tone = 'amber' }: TickerProps) {
  const line = items.join('   ·   ');
  return (
    <div className={`hns-ticker ${accentClass[tone]}`} aria-hidden="true">
      <div className="hns-ticker__track">
        <span>{line}   ·   </span>
        <span>{line}   ·   </span>
      </div>
    </div>
  );
}

/** Highlighter block behind a run of words. */
export function Mark({ children, tone = 'amber' }: { children: ReactNode; tone?: Tone }) {
  return <mark className={`hns-mark ${accentClass[tone]}`}>{children}</mark>;
}
