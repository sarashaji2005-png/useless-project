import { useCallback } from 'react';
import { LiveStage, type StageDims } from './LiveStage';
import { centroid } from '../core/geometry2d';
import { coneEdges, LEADER_LINE_THRESHOLD, SIGHT_RADIUS_FRAC } from '../core/screenVisibility';
import { buildOverlayDiagnostics } from '../core/diagnostics';
import { bandStyle, BETTER_WORD, formatScoreShort } from '../core/scoreDisplay';
import { displayFont, monoFont, palette, withAlpha } from '../design/tokens';
import type { SuggestionSet, TickResult, Track } from '../models/types';

/**
 * Screen 1's overlay. All canvas plumbing lives in LiveStage; this is just the
 * draw function plus its data.
 *
 * VISUAL HIERARCHY (Part H), enforced by ratio rather than hand-picked sizes:
 *   1. score badge  — dominant, derived from canvas width
 *   2. suggestion   — small footnote, never competes
 *   3. ids / labels — smallest, fixed
 * The badge font scales with the canvas because a fixed px size that reads well
 * on a laptop is unreadable on a projector.
 */

const BADGE_FONT_FRAC = 0.03;
const BADGE_FONT_MIN = 22;
const BADGE_FONT_MAX = 64;
const BAND_LABEL_RATIO = 0.34;
/** The "/100" scale suffix inside the circle, relative to the number. */
const SCALE_LABEL_RATIO = 0.3;
const SUGGESTION_FONT_RATIO = 0.36;
const SUGGESTION_FONT_MIN = 11;
const META_FONT_PX = 10;

/**
 * Overlay palette, all from the shared tokens.
 *
 * Role assignment is deliberate: amber is chrome and the teacher, red only ever
 * marks an occlusion penalty (a real problem), green marks a safer alternative.
 * Occupied vs empty chairs are distinguished by the warm neutral ramp rather
 * than by spending an accent colour on them.
 */
const COLOURS = {
  occupied: palette.amber,
  empty: palette.textDim,
  unconfirmed: palette.textFaint,
  person: palette.amberDim,
  teacher: palette.amber,
  leader: withAlpha(palette.red, 0.7),
  suggestion: palette.green,
  panelBg: withAlpha(palette.bg, 0.86),
  panelLine: palette.line,
};

interface Props {
  stream: MediaStream | null;
  frameWidth: number;
  frameHeight: number;
  frozenFrame: HTMLCanvasElement | null;
  result: TickResult | null;
  bestChairScore: number;
  facingDeg: number;
  running: boolean;
}

export function FeedOverlay({
  stream,
  frameWidth,
  frameHeight,
  frozenFrame,
  result,
  bestChairScore,
  facingDeg,
  running,
}: Props) {
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, d: StageDims) => {
      const { cssW, cssH, X, Y } = d;

      const badgeFont = Math.round(
        Math.min(BADGE_FONT_MAX, Math.max(BADGE_FONT_MIN, cssW * BADGE_FONT_FRAC)),
      );
      const bandFont = Math.max(8, Math.round(badgeFont * BAND_LABEL_RATIO));
      const scaleFont = Math.max(8, Math.round(badgeFont * SCALE_LABEL_RATIO));
      const suggestionFont = Math.max(
        SUGGESTION_FONT_MIN,
        Math.round(badgeFont * SUGGESTION_FONT_RATIO),
      );

      const seatStateById = new Map((result?.seatStates ?? []).map((s) => [s.seatId, s]));
      const trackById = new Map<string, Track>();
      for (const t of [...(result?.chairs ?? []), ...(result?.people ?? [])]) {
        trackById.set(t.id, t);
      }
      const suggestionBySeat = new Map<string, SuggestionSet>(
        (result?.suggestions ?? []).map((s) => [s.seatId, s]),
      );

      // --- teacher cone --------------------------------------------------
      const teacher = result?.teacherPoint;
      if (teacher) {
        const radiusPx = Math.hypot(frameWidth, frameHeight) * SIGHT_RADIUS_FRAC;
        const [e1, e2] = coneEdges(teacher, facingDeg, radiusPx);

        ctx.beginPath();
        ctx.moveTo(X(teacher.x), Y(teacher.y));
        ctx.lineTo(X(e1.x), Y(e1.y));
        ctx.lineTo(X(e2.x), Y(e2.y));
        ctx.closePath();
        ctx.fillStyle = withAlpha(palette.amber, 0.07);
        ctx.fill();
        ctx.strokeStyle = withAlpha(palette.amber, 0.3);
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = COLOURS.teacher;
        ctx.beginPath();
        ctx.arc(X(teacher.x), Y(teacher.y), 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = palette.bg;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = COLOURS.teacher;
        ctx.font = monoFont(META_FONT_PX + 1, "bold");
        ctx.fillText('THREAT', X(teacher.x) + 11, Y(teacher.y) + 4);
      }

      // --- people --------------------------------------------------------
      for (const p of result?.people ?? []) {
        ctx.strokeStyle = p.confirmed ? COLOURS.person : COLOURS.unconfirmed;
        ctx.lineWidth = p.confirmed ? 1.2 : 1;
        ctx.setLineDash(p.confirmed ? [] : [3, 3]);
        ctx.strokeRect(X(p.box.px), Y(p.box.py), X(p.box.width), Y(p.box.height));
        ctx.setLineDash([]);
        ctx.fillStyle = p.confirmed ? COLOURS.person : COLOURS.unconfirmed;
        ctx.font = monoFont(META_FONT_PX - 1);
        ctx.fillText(p.id, X(p.box.px), Y(p.box.py) - 3);
      }

      // --- occlusion leader lines ----------------------------------------
      for (const state of result?.seatStates ?? []) {
        if (!state.occlusionSource) continue;
        const dominant = state.blockers[0];
        if (!dominant || dominant.obstruction < LEADER_LINE_THRESHOLD) continue;

        const chair = trackById.get(state.seatId);
        const blocker = trackById.get(state.occlusionSource);
        if (!chair || !blocker) continue;

        const a = centroid(chair.box);
        const b = centroid(blocker.box);
        ctx.strokeStyle = COLOURS.leader;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(X(a.x), Y(a.y));
        ctx.lineTo(X(b.x), Y(b.y));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // --- suggestion arrows, drawn under the badges ----------------------
      for (const set of result?.suggestions ?? []) {
        const pick = set.displayed;
        if (!pick) continue;
        const from = trackById.get(set.seatId);
        const to = trackById.get(pick.targetSeatId);
        if (!from || !to) continue;

        drawArrow(
          ctx,
          { x: X(centroid(from.box).x), y: Y(centroid(from.box).y) },
          { x: X(centroid(to.box).x), y: Y(centroid(to.box).y) },
          COLOURS.suggestion,
        );
      }

      // --- chairs --------------------------------------------------------
      for (const chair of result?.chairs ?? []) {
        const state = seatStateById.get(chair.id);
        const occupied = state?.occupied ?? false;

        const border = !chair.confirmed
          ? COLOURS.unconfirmed
          : occupied
            ? COLOURS.occupied
            : COLOURS.empty;

        ctx.strokeStyle = border;
        ctx.lineWidth = occupied ? 2.4 : 1.4;
        ctx.setLineDash(chair.confirmed ? [] : [4, 4]);
        ctx.strokeRect(X(chair.box.px), Y(chair.box.py), X(chair.box.width), Y(chair.box.height));
        ctx.setLineDash([]);

        if (!chair.confirmed) {
          ctx.fillStyle = COLOURS.unconfirmed;
          ctx.font = monoFont(META_FONT_PX);
    
          continue;
        }

        const cx = X(chair.box.px + chair.box.width / 2);
        const boxTop = Y(chair.box.py);

        // CIRCULAR badge. The score splits across two lines inside the circle —
        // the number large, "/100" small beneath it. Fitting "82/100" on one line
        // would force a circle roughly twice as wide as the chair itself, since a
        // circle has to enclose the full text width across its diameter.
        const numLabel = state ? formatScoreShort(state.visibilityScore) : '--';
        const scaleLabel = '/100';
        const style = state ? bandStyle(state.visibilityScore) : null;

        ctx.font = monoFont(badgeFont, "bold");
        const numW = ctx.measureText(numLabel).width;
        ctx.font = monoFont(scaleFont, "bold");
        const scaleW = ctx.measureText(scaleLabel).width;

        // Radius must enclose the text block's diagonal, not just its width.
        const contentW = Math.max(numW, scaleW);
        const contentH = badgeFont * 0.74 + scaleFont * 1.1;
        const radius = Math.max(
          badgeFont * 0.72,
          Math.hypot(contentW, contentH) / 2 + badgeFont * 0.16,
        );

        let ccx = cx;
        let ccy = boxTop - radius - 8;
        // A score clipped off the top edge is the whole feature failing, so flip
        // below the box instead.
        if (ccy - radius < 2) ccy = Y(chair.box.py + chair.box.height) + radius + 8;
        ccx = Math.max(radius + 2, Math.min(cssW - radius - 2, ccx));

        ctx.beginPath();
        ctx.arc(ccx, ccy, radius, 0, Math.PI * 2);
        ctx.fillStyle = style?.bg ?? COLOURS.panelBg;
        ctx.fill();
        ctx.strokeStyle = style?.fg ?? COLOURS.empty;
        ctx.lineWidth = Math.max(2, badgeFont * 0.07);
        ctx.stroke();

        ctx.fillStyle = style?.fg ?? COLOURS.empty;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = monoFont(badgeFont, "bold");
        ctx.fillText(numLabel, ccx, ccy - scaleFont * 0.52);
        ctx.globalAlpha = 0.72;
        ctx.font = monoFont(scaleFont, "bold");
        ctx.fillText(scaleLabel, ccx, ccy + badgeFont * 0.40);
        ctx.globalAlpha = 1;
        ctx.textBaseline = 'alphabetic';

        // Band word sits outside the circle rather than being crammed inside it.
        if (style) {
          ctx.font = displayFont(bandFont, "700");
          ctx.fillText(style.label, ccx, ccy + radius + bandFont + 3);
        }
        ctx.textAlign = 'left';

        ctx.fillStyle = border;
        ctx.font = monoFont(META_FONT_PX);
        const occlusionNote =
          state && state.obstruction > 0.02
            ? `  base ${formatScoreShort(state.baseScore)} −${Math.round(state.baseScore - state.visibilityScore)}`
            : '';
        ctx.fillText(
          `${chair.id} · ${occupied ? 'OCC' : 'EMPTY'}${occlusionNote}`,
          X(chair.box.px),
          Y(chair.box.py + chair.box.height) + META_FONT_PX + 2,
        );

        const set = suggestionBySeat.get(chair.id);
        const pick = set?.displayed;
        if (pick) {
          const text = `${BETTER_WORD}: ${pick.targetSeatId}  ${formatScoreShort(pick.targetScore)} vs ${formatScoreShort(pick.currentScore)}`;
          ctx.font = monoFont(suggestionFont, "bold");
          const tw = ctx.measureText(text).width;
          const tx = Math.max(2, Math.min(cssW - tw - 10, X(chair.box.px)));
          const ty = Y(chair.box.py + chair.box.height) + META_FONT_PX + suggestionFont + 8;

          ctx.fillStyle = withAlpha(palette.greenDim, 0.85);
          ctx.fillRect(tx - 4, ty - suggestionFont, tw + 8, suggestionFont + 6);
          ctx.strokeStyle = COLOURS.suggestion;
          ctx.lineWidth = 1;
          ctx.strokeRect(tx - 4, ty - suggestionFont, tw + 8, suggestionFont + 6);
          ctx.fillStyle = COLOURS.suggestion;
          ctx.fillText(text, tx, ty);

          if (set && set.totalAlternatives > 1) {
            ctx.font = monoFont(META_FONT_PX);
            ctx.fillStyle = COLOURS.empty;
            ctx.fillText(`+${set.totalAlternatives - 1} more`, tx + tw + 10, ty);
          }
        }
      }

      // --- prompts and diagnostics ---------------------------------------
      if (!teacher && running) {
        ctx.fillStyle = withAlpha(palette.bg, 0.8);
        ctx.fillRect(0, cssH / 2 - 22, cssW, 44);
        ctx.fillStyle = COLOURS.teacher;
        ctx.font = displayFont(16, "700");
        ctx.textAlign = 'center';
        
        ctx.textAlign = 'left';
      }

      drawDiagnostics(ctx, buildOverlayDiagnostics(result, bestChairScore), running);

      if (frozenFrame) {
        ctx.fillStyle = COLOURS.teacher;
        ctx.font = monoFont(12, "bold");
        ctx.textAlign = 'right';
        
        ctx.textAlign = 'left';
      }
    },
    [bestChairScore, facingDeg, frameHeight, frameWidth, frozenFrame, result, running],
  );

  return (
    <LiveStage
      stream={stream}
      frameWidth={frameWidth}
      frameHeight={frameHeight}
      frozenFrame={frozenFrame}
      draw={draw}
      /*
       * No onPick any more. The teacher position is a fixed front-of-room
       * reference derived from frame size (see core/roomConfig), so there is
       * nothing for a click on the feed to set.
       */
    />
  );
}

/** Thin arrow with a small head. Subtle by design — must not rival the badges. */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  colour: string,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 12) return;

  const ux = dx / len;
  const uy = dy / len;
  const tipX = to.x - ux * 10;
  const tipY = to.y - uy * 10;

  ctx.strokeStyle = colour;
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(from.x + ux * 10, from.y + uy * 10);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.setLineDash([]);

  const head = 8;
  const a = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - head * Math.cos(a - 0.4), tipY - head * Math.sin(a - 0.4));
  ctx.lineTo(tipX - head * Math.cos(a + 0.4), tipY - head * Math.sin(a + 0.4));
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawDiagnostics(
  ctx: CanvasRenderingContext2D,
  lines: ReturnType<typeof buildOverlayDiagnostics>,
  running: boolean,
) {
  const pad = 8;
  const lh = 13;
  const w = 240;
  const h = lines.length * lh + pad * 2 + 14;

  ctx.fillStyle = COLOURS.panelBg;
  ctx.fillRect(pad, pad, w, h);
  ctx.strokeStyle = COLOURS.panelLine;
  ctx.lineWidth = 1;
  ctx.strokeRect(pad, pad, w, h);

  ctx.font = monoFont(9, "bold");
  ctx.fillStyle = running ? palette.green : palette.textDim;
 
  ctx.font = monoFont(10);
  lines.forEach((line, i) => {
    const y = pad + 30 + i * lh;
    ctx.fillStyle = palette.textDim;
    ctx.fillText(line.stage.padEnd(10), pad + 8, y);
    ctx.fillStyle = line.suspect ? palette.amber : palette.text;
    ctx.fillText(line.value, pad + 78, y);
  });
}
