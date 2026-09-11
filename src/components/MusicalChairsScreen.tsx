import { useCallback, useEffect, useRef, useState } from 'react';
import { LiveStage, type StageDims } from './LiveStage';
import { useMusic } from '../audio/useMusic';
import {
  captionTransform,
  pickRandomChair,
  pulseScale,
  pulseUnit,
  REVEAL_TEXT,
  riseTransform,
  shockwavePhase,
  trackedChairs,
  type PickResult,
} from '../core/chairPick';
import { ChairRoam } from '../core/chairRoam';
import { roundedRectPath } from '../design/canvas';
import { monoFont, palette, playfulFont, withAlpha } from '../design/tokens';
import { AUTO_COOLDOWN_MS, NewPersonWatcher } from '../core/personWatcher';
import type { ScanEngineState } from '../detect/useScanEngine';
import type { TickResult } from '../models/types';

const MUSIC_SRC = '/sounds/cid-moosa.mp3';

/** Fixed round length. Audio is cut here regardless of the file's real length. */
const ROUND_MS = 10_000;

type Phase = 'idle' | 'playing' | 'revealed';

interface Props {
  stream: MediaStream | null;
  scan: ScanEngineState;
  frameWidth: number;
  frameHeight: number;
  onScan: () => void;
  onReturn: () => void;
}

export function MusicalChairsScreen({
  stream,
  scan,
  frameWidth,
  frameHeight,
  onScan,
  onReturn,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [pick, setPick] = useState<PickResult | null>(null);

  // Latest tick and timing live in refs: the animation loop reads them every
  // frame and must not restart the loop when React re-renders.
  const resultRef = useRef<TickResult | null>(scan.lastResult);
  resultRef.current = scan.lastResult;

  const startedAtRef = useRef(0);
  const revealedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const roamRef = useRef<ChairRoam | null>(null);

  // Auto-trigger state. The lock timestamp lives in a ref because the draw loop
  // reads it every frame for the on-feed indicator.
  const watcherRef = useRef(new NewPersonWatcher());
  const lockedUntilRef = useRef(0);
  const [autoEnabled, setAutoEnabled] = useState(true);

  const music = useMusic(MUSIC_SRC);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const finish = useCallback(() => {
    clearTimer();
    music.stop();
    // Re-arm only after the quiet period, so a group entering together does not
    // wipe the reveal before anyone can read it.
    lockedUntilRef.current = performance.now() + AUTO_COOLDOWN_MS;

    // Selection reads the LIVE list at this instant, not a frozen snapshot.
    const chosen = pickRandomChair(resultRef.current);

    if (!chosen) {
      // No tracked chairs at all. Nothing to reveal; drop back to idle rather
      // than throwing or rendering an error state.
      roamRef.current = null;
      setPick(null);
      setPhase('idle');
      return;
    }

    // Stop the roam ON the chosen chair. The landing coordinate comes from the
    // pick, so the indicator cannot end up anywhere else.
    roamRef.current?.land(chosen);

    revealedAtRef.current = performance.now();
    setPick(chosen);
    setPhase('revealed');
  }, [clearTimer, music]);

  const startMusic = useCallback(() => {
    // Pressing again mid-round restarts it, which is also the reset path.
    clearTimer();
    setPick(null);
    setPhase('playing');
    startedAtRef.current = performance.now();
    roamRef.current = new ChairRoam(startedAtRef.current);
    // Hard lock for the duration; finish() replaces this with the cooldown.
    lockedUntilRef.current = Number.POSITIVE_INFINITY;

    music.play();
    timerRef.current = window.setTimeout(finish, ROUND_MS);
  }, [clearTimer, finish, music]);

  // Cancel a pending round if we navigate away.
  useEffect(() => clearTimer, [clearTimer]);

  /**
   * Part C — automatic trigger.
   *
   * Runs per tick rather than per frame: `observe` is idempotent per tick number,
   * so this effect re-running for unrelated reasons cannot double-count an
   * arrival.
   *
   * The watcher is fed on EVERY tick even while locked, so people arriving during
   * a round are absorbed into the baseline instead of queueing up and firing a
   * stale round the moment the cooldown lifts.
   */
  useEffect(() => {
    const result = scan.lastResult;
    if (!result) return;

    const arrivals = watcherRef.current.observe(result);
    if (arrivals.length === 0) return;
    if (!autoEnabled) return;
    if (phase === 'playing') return;
    if (performance.now() < lockedUntilRef.current) return;

    startMusic();
  }, [scan.lastResult, autoEnabled, phase, startMusic]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, d: StageDims) => {
      const result = resultRef.current;
      // Read fresh every frame — this is the live tracked list from the shared
      // detection pipeline, never a frozen or static layout.
      const chairs = trackedChairs(result);
      const now = performance.now();

      const roam = roamRef.current;
      if (roam && phase === 'playing') {
        // Hops are chosen against the CURRENT list, so chairs gained or lost to
        // detection jitter are picked up at the very next hop.
        roam.update(now, chairs);
      }
      const roamSeatId = phase === 'playing' ? roam?.currentSeatId : null;

      // --- all tracked chairs ---------------------------------------------
      for (const chair of chairs) {
        const isPicked = phase === 'revealed' && pick?.seatId === chair.seatId;
        // The picked chair is drawn separately, risen and scaled.
        if (isPicked) continue;

        const dim = phase === 'revealed';
        const isRoamTarget = chair.seatId === roamSeatId;

        const x = d.X(chair.box.px);
        const y = d.Y(chair.box.py);
        const w = d.X(chair.box.width);
        const h = d.Y(chair.box.height);

        // The roaming indicator IS the chair lighting up — no separate marker
        // floating over it. The highlight lands on the detected box itself.
        if (isRoamTarget) {
          ctx.save();
          ctx.shadowColor = withAlpha(palette.amber, 0.85);
          ctx.shadowBlur = 20;
          ctx.fillStyle = withAlpha(palette.amber, 0.16);
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = palette.amber;
          ctx.lineWidth = 3.4;
          ctx.strokeRect(x, y, w, h);
          ctx.restore();
          continue;
        }

        ctx.strokeStyle = chair.occupied
          ? dim
            ? withAlpha(palette.text, 0.3)
            : palette.text
          : dim
            ? withAlpha(palette.textFaint, 0.6)
            : palette.textDim;
        ctx.lineWidth = chair.occupied ? 2 : 1.4;
        ctx.strokeRect(x, y, w, h);
      }

      // --- round progress --------------------------------------------------
      if (phase === 'playing') {
        const progress = Math.min(1, (now - startedAtRef.current) / ROUND_MS);
        const barH = Math.max(4, d.cssH * 0.008);
        ctx.fillStyle = withAlpha(palette.bg, 0.8);
        ctx.fillRect(0, d.cssH - barH, d.cssW, barH);
        ctx.fillStyle = palette.amber;
        ctx.fillRect(0, d.cssH - barH, d.cssW * progress, barH);
      }

      // --- the reveal ------------------------------------------------------
      if (phase === 'revealed' && pick) {
        const elapsed = now - revealedAtRef.current;
        const { eased, box } = riseTransform(pick.box, elapsed);

        // Breathing scale applied about the box centre, so the whole highlight
        // pulses in place rather than growing off to one side.
        const beat = pulseScale(now);
        const bcx = d.X(box.px + box.width / 2);
        const bcy = d.Y(box.py + box.height / 2);
        const w = d.X(box.width) * beat;
        const h = d.Y(box.height) * beat;
        const x = bcx - w / 2;
        const y = bcy - h / 2;

        const unit = pulseUnit(now);
        // Ramps in with the rise, then oscillates instead of sitting static.
        const heat = eased * (0.78 + 0.22 * unit);

        ctx.save();

        // Wide soft halo. Drawn first and separately from the rings so the glow
        // reads as light spilling off the chair rather than a thick border.
        const haloR = Math.max(w, h) * (0.85 + 0.12 * unit);
        const halo = ctx.createRadialGradient(bcx, bcy, Math.min(w, h) * 0.2, bcx, bcy, haloR);
        halo.addColorStop(0, withAlpha(palette.playfulBright, 0.34 * heat));
        halo.addColorStop(0.55, withAlpha(palette.playful, 0.14 * heat));
        halo.addColorStop(1, withAlpha(palette.playful, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(bcx, bcy, haloR, 0, Math.PI * 2);
        ctx.fill();

        // Shockwave ring, expanding and fading on a loop.
        const wave = shockwavePhase(now);
        const waveR = Math.max(w, h) * (0.55 + wave * 0.9);
        ctx.strokeStyle = withAlpha(palette.playfulBright, (1 - wave) * 0.55 * eased);
        ctx.lineWidth = 3 * (1 - wave) + 0.5;
        ctx.beginPath();
        ctx.arc(bcx, bcy, waveR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.shadowColor = withAlpha(palette.playful, 0.95);
        ctx.shadowBlur = 34 * heat;

        // Saturated fill, pulsing.
        ctx.fillStyle = withAlpha(palette.playful, (0.16 + 0.12 * unit) * eased);
        ctx.fillRect(x, y, w, h);

        // Concentric rings, brightest innermost.
        for (const [i, alpha] of [1, 0.55, 0.25].entries()) {
          ctx.strokeStyle = withAlpha(palette.playful, alpha * heat);
          ctx.lineWidth = 5 - i * 1.5;
          ctx.strokeRect(x - i * 6, y - i * 6, w + i * 12, h + i * 12);
        }

        // White-hot inner edge. This is what makes it read as *bright* rather
        // than merely green at high opacity.
        ctx.shadowBlur = 12 * heat;
        ctx.strokeStyle = withAlpha(palette.textBright, 0.9 * heat);
        ctx.lineWidth = 1.6;
        ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);

        ctx.restore();

        // --- reveal caption ------------------------------------------------
        // Playful font, small: a pop, not an announcement. Pops in with an
        // overshoot and a damped wiggle, then settles and stays put.
        const cap = captionTransform(elapsed);
        if (cap.visible) {
          const fontPx = Math.max(15, Math.round(d.cssW * 0.021));
          ctx.font = playfulFont(fontPx);
          const tw = ctx.measureText(REVEAL_TEXT).width;

          const padX = Math.round(fontPx * 0.62);
          const boxW = tw + padX * 2;
          const boxH = Math.round(fontPx * 1.75);

          // Centre point, clamped so the pill can never leave frame. Clamping the
          // centre rather than the corner keeps the scale-about-centre correct.
          let ccx = bcx;
          let ccy = y - boxH / 2 - 10;
          ccx = Math.max(boxW / 2 + 4, Math.min(d.cssW - boxW / 2 - 4, ccx));
          if (ccy - boxH / 2 < 4) {
            ccy = Math.min(d.cssH - boxH / 2 - 4, y + h + boxH / 2 + 10);
          }

          ctx.save();
          ctx.translate(ccx, ccy);
          ctx.rotate(cap.rotation);
          ctx.scale(cap.scale, cap.scale);
          ctx.globalAlpha = cap.alpha;

          roundedRectPath(ctx, -boxW / 2, -boxH / 2, boxW, boxH, boxH * 0.42);
          ctx.fillStyle = withAlpha(palette.playfulDeep, 0.94);
          ctx.fill();
          ctx.strokeStyle = palette.playful;
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = palette.playfulBright;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(REVEAL_TEXT, 0, fontPx * 0.06);
          ctx.restore();
        }
      }

      // --- auto-trigger state, small corner pill ---------------------------
      {
        const locked = now < lockedUntilRef.current;
        const label = !autoEnabled
          ? 'AUTO OFF'
          : !scan.running
            ? 'AUTO IDLE'
            : locked
              ? 'COOLDOWN'
              : watcherRef.current.isWarm
                ? 'AUTO ARMED'
                : 'BASELINE';
        const colour = !autoEnabled || !scan.running
          ? palette.textDim
          : locked
            ? palette.amber
            : watcherRef.current.isWarm
              ? palette.green
              : palette.text;

        const f = Math.max(9, Math.round(d.cssW * 0.011));
        ctx.font = monoFont(f, "bold");
        const tw = ctx.measureText(label).width;
        const pw = tw + f * 1.6;
        const ph = f * 2.1;
        const px = d.cssW - pw - 8;

        roundedRectPath(ctx, px, 8, pw, ph, ph / 2);
        ctx.fillStyle = withAlpha(palette.bg, 0.85);
        ctx.fill();
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.fillStyle = colour;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, px + pw / 2, 8 + ph / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
    },
    [phase, pick, autoEnabled, scan.running],
  );

  return (
    <>
      <div className="row screen-nav playful">
        <button onClick={onReturn}>◀</button>
        <button onClick={onScan} disabled={scan.running}>
          Scan
        </button>
        {/* Manual trigger kept deliberately: auto-detection on stage is not
            something to bet the demo on. */}
        <button className="primary" onClick={startMusic}>
          Start Music
        </button>
        <button
          className={autoEnabled ? 'on' : ''}
          onClick={() => setAutoEnabled((v) => !v)}
          aria-pressed={autoEnabled}
        >
          Auto {autoEnabled ? 'On' : 'Off'}
        </button>
      </div>

      <LiveStage
        stream={stream}
        frameWidth={frameWidth}
        frameHeight={frameHeight}
        draw={draw}
        animate={phase === 'playing' || phase === 'revealed'}
        cursor="default"
      />

      {/* Canvas text is invisible to assistive tech, so the outcome is mirrored
          into a live region. Not visible copy. */}
      <p className="sr-only" aria-live="polite">
        {phase === 'revealed' && pick ? `${pick.seatId}. ${REVEAL_TEXT}` : ''}
      </p>
    </>
  );
}
