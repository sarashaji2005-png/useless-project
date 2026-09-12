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
import { monoFont, palette, playfulIntlFont, withAlpha } from '../design/tokens';
import { formatScore } from '../core/scoreDisplay';
import { AUTO_COOLDOWN_MS, NewPersonWatcher } from '../core/personWatcher';
import { logChairCoverage, logSelection } from '../core/diagnostics';
import {
  canOfferRedo,
  CONFIRM_NO,
  CONFIRM_PROMPT,
  CONFIRM_YES,
  FORCED_LOCK_TEXT,
  nextRedoAction,
  REDO_LIMIT,
  redosLeft,
  selectionNumber,
} from '../core/seatConfirm';
import type { ScanEngineState } from '../detect/useScanEngine';
import type { TickResult } from '../models/types';

/**
 * Built from BASE_URL, not a leading slash.
 *
 * On GitHub Pages the app is served from /useless-project/, so '/sounds/...' would
 * resolve against the domain root and 404. BASE_URL is '/' in dev, so this is
 * unchanged locally.
 */
const MUSIC_SRC = `${import.meta.env.BASE_URL}sounds/cid-moosa.mp3`;

/** Fixed round length. Audio is cut here regardless of the file's real length. */
const ROUND_MS = 10_000;

/** How often chair coverage is sampled across the window. */
const COVERAGE_SAMPLE_MS = 2_000;

/**
 * The reveal title. Malayalam, unchanged — it is the punchline.
 *
 * This is the INITIAL reveal-with-score moment only. The two end-states carry
 * their own captions: `REVEAL_TEXT` on confirm, `FORCED_LOCK_TEXT` on the third
 * rejection. Exactly one of the three is ever on screen.
 */
const REVEAL_TITLE = 'കസേര കണ്ടില്ലേ?';

/** Small-caps label above the number, so "82/100" is not bare. */
const RISK_LABEL = 'DETECTION RISK';

/**
 * `revealed` carries the confirm/reject prompt. Both settled states keep the chair
 * highlight on screen and differ only in caption:
 *   `locked`      — user confirmed; the existing seat-fixed end-state.
 *   `forceLocked` — user rejected a third time; hard stop, no buttons.
 *
 * The round and selection logic is untouched by any of this; a redo simply calls
 * the existing sequence again.
 */
type Phase = 'idle' | 'playing' | 'revealed' | 'locked' | 'forceLocked';

/** What the reveal needs, captured once at music stop so it cannot drift. */
interface Reveal {
  pick: PickResult;
  /** Visibility/risk score of the allotted seat, 0-100. Null if unscored. */
  score: number | null;
  /** Size of the pool it was drawn from, for the log and the sub-line. */
  poolSize: number;
  fromVacant: boolean;
}

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
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const pick = reveal?.pick ?? null;

  /** Redos used in the CURRENT person's turn. Reset when a new turn begins. */
  const [redoUsed, setRedoUsed] = useState(0);

  /** Seat decided, either way. No further buttons in this turn. */
  const settled = phase === 'locked' || phase === 'forceLocked';

  /**
   * A selection has completed and is waiting on an answer.
   *
   * `finish()` sets `revealed` on every single completed selection — the first and
   * each redo alike — so this is true once per selection, unconditionally, and is
   * the only thing the prompt is gated on.
   */
  const awaitingAnswer = phase === 'revealed';

  /**
   * Whether the Yes/No prompt is on screen.
   *
   * Deliberately NOT conditioned on `redoUsed`: `canOfferRedo` returns true for
   * every count up to and including the spent one, so the prompt is identical on
   * all three selections.
   */
  const promptVisible = awaitingAnswer && canOfferRedo(redoUsed, settled);

  /** The chair highlight and card are on screen for all three of these. */
  const showingReveal = phase === 'revealed' || settled;

  // Latest tick and timing live in refs: the animation loop reads them every
  // frame and must not restart the loop when React re-renders.
  const resultRef = useRef<TickResult | null>(scan.lastResult);
  resultRef.current = scan.lastResult;

  const startedAtRef = useRef(0);
  const revealedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const roamRef = useRef<ChairRoam | null>(null);
  const coverageTimerRef = useRef<number | null>(null);
  /** Chair ids seen in every coverage sample this round. */
  const coverageStableRef = useRef<string[]>([]);

  // Auto-trigger state. The lock timestamp lives in a ref because the draw loop
  // reads it every frame for the on-feed indicator.
  const watcherRef = useRef(new NewPersonWatcher());
  const lockedUntilRef = useRef(0);
  const [autoEnabled, setAutoEnabled] = useState(true);

  const music = useMusic(MUSIC_SRC);

  /**
   * Dev-only: `?preview=reveal` jumps straight to the revealed state with a
   * synthetic pick, so the reveal card can be captured headlessly with no camera
   * and no 10-second wait. Stripped from production by `import.meta.env.DEV`.
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const raw = new URLSearchParams(window.location.search).get('preview');
    // Preview values are the Phase names verbatim, so there is no mapping to get
    // wrong and no cast to hide a typo behind.
    const previews: Phase[] = ['revealed', 'locked', 'forceLocked'];
    const want = previews.find((p) => p === raw);
    if (!want) return;

    // Frame pixels, roughly centred in a 640x480 frame.
    const box = { px: 268, py: 226, width: 112, height: 132 };
    // Wind the clock back so the pop-in animation has already settled when the
    // screenshot is taken, rather than catching it mid-overshoot.
    revealedAtRef.current = performance.now() - 2_000;
    setReveal({
      pick: {
        seatId: 'chair-07',
        box,
        centre: { x: box.px + box.width / 2, y: box.py + box.height / 2 },
        fromVacant: true,
        poolSize: 11,
      },
      score: 63,
      poolSize: 11,
      fromVacant: true,
    });
    // forceLocked implies the allowance was spent getting there.
    if (want === 'forceLocked') setRedoUsed(REDO_LIMIT);
    setPhase(want);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * Part A — coverage sampling across the window.
   *
   * Samples the tracked chair list every couple of seconds rather than once,
   * because the failure being chased is intermittent: a chair that appears on some
   * ticks and not others reads as "barely any chairs" while each individual tick
   * looks fine. `coverageStableRef` accumulates the intersection — chair ids
   * present in EVERY sample — which is the number to compare against the real
   * chair count in the room.
   */
  const stopCoverageSampling = useCallback(() => {
    if (coverageTimerRef.current !== null) {
      window.clearInterval(coverageTimerRef.current);
      coverageTimerRef.current = null;
    }
  }, []);

  const startCoverageSampling = useCallback(() => {
    stopCoverageSampling();
    coverageStableRef.current = [];
    let sample = 0;

    const take = () => {
      sample += 1;
      const result = resultRef.current;
      const confirmed = (result?.chairs ?? []).filter((c) => c.confirmed).map((c) => c.id);

      coverageStableRef.current =
        sample === 1
          ? confirmed
          : coverageStableRef.current.filter((id) => confirmed.includes(id));

      logChairCoverage(`t+${((sample - 1) * COVERAGE_SAMPLE_MS) / 1000}s`, result, coverageStableRef.current);
    };

    take(); // sample immediately at t+0
    coverageTimerRef.current = window.setInterval(take, COVERAGE_SAMPLE_MS);
  }, [stopCoverageSampling]);

  const finish = useCallback(() => {
    clearTimer();
    music.stop();
    // Re-arm only after the quiet period, so a group entering together does not
    // wipe the reveal before anyone can read it.
    lockedUntilRef.current = performance.now() + AUTO_COOLDOWN_MS;

    stopCoverageSampling();

    // Selection reads the LIVE list at this instant, not a frozen snapshot, so it
    // draws from every chair detection currently held — the full vacant pool.
    const result = resultRef.current;
    const chosen = pickRandomChair(result);

    if (!chosen) {
      // No tracked chairs at all. Nothing to reveal; drop back to idle rather
      // than throwing or rendering an error state.
      roamRef.current = null;
      setReveal(null);
      setPhase('idle');
      return;
    }

    // Stop the roam ON the chosen chair. The landing coordinate comes from the
    // pick, so the indicator cannot end up anywhere else.
    roamRef.current?.land(chosen);

    // Score is captured NOW rather than read live during the reveal. The teacher
    // reference and occlusion keep updating every tick, and a number that drifts
    // while it is being read is worse than a slightly stale one.
    const scored = result?.seatStates.find((s) => s.seatId === chosen.seatId);

    logSelection(chosen, scored?.visibilityScore ?? null, coverageStableRef.current);

    revealedAtRef.current = performance.now();
    setReveal({
      pick: chosen,
      score: scored ? scored.visibilityScore : null,
      poolSize: chosen.poolSize,
      fromVacant: chosen.fromVacant,
    });
    setPhase('revealed');
  }, [clearTimer, music, stopCoverageSampling]);

  const startMusic = useCallback(() => {
    // Pressing again mid-round restarts it, which is also the reset path.
    clearTimer();
    setReveal(null);
    setPhase('playing');
    startedAtRef.current = performance.now();
    roamRef.current = new ChairRoam(startedAtRef.current);
    // Hard lock for the duration; finish() replaces this with the cooldown.
    lockedUntilRef.current = Number.POSITIVE_INFINITY;

    startCoverageSampling();
    music.play();
    timerRef.current = window.setTimeout(finish, ROUND_MS);
  }, [clearTimer, finish, music, startCoverageSampling]);

  /**
   * A new person's turn: allowance back to zero, then the existing round.
   *
   * The reset lives here rather than inside `startMusic` precisely because
   * `startMusic` is shared with rescan — resetting in there would hand out
   * unlimited rescans.
   */
  const beginTurn = useCallback(() => {
    setRedoUsed(0);
    startMusic();
  }, [startMusic]);

  /** Confirm: lock this seat in and go to the existing seat-fixed end-state. */
  const confirmSeat = useCallback(() => {
    // Reset the caption clock so the new line pops in rather than cutting.
    revealedAtRef.current = performance.now();
    setPhase('locked');
  }, []);

  /**
   * Reject: re-run the existing sequence, or force-lock if the allowance is spent.
   *
   * Nothing here reimplements selection — `startMusic()` is the same round, the
   * same roam, and the same `pickRandomChair` as the first time.
   */
  const rejectSeat = useCallback(() => {
    const action = nextRedoAction(redoUsed);

    if (action.kind === 'forceLock') {
      // Third rejection. The chair on screen stays; it is now the user's seat
      // whether they like it or not.
      revealedAtRef.current = performance.now();
      setPhase('forceLocked');
      return;
    }

    setRedoUsed(action.count);
    startMusic();
  }, [redoUsed, startMusic]);

  // Cancel a pending round and stop sampling if we navigate away.
  useEffect(
    () => () => {
      clearTimer();
      stopCoverageSampling();
    },
    [clearTimer, stopCoverageSampling],
  );

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
    // An unanswered prompt outranks the cooldown. AUTO_COOLDOWN_MS is only 5s, so
    // without this a passer-by 5 seconds after a selection would wipe the prompt
    // AND silently reset the redo count — which is exactly the "prompt only shows
    // sometimes / only on the first attempt" failure. The prompt now blocks
    // re-triggering until it is answered; manual Start Music is still the escape.
    if (awaitingAnswer) return;
    if (performance.now() < lockedUntilRef.current) return;

    // A new arrival is a new person's turn, so the redo count starts fresh.
    beginTurn();
  }, [scan.lastResult, autoEnabled, phase, awaitingAnswer, beginTurn]);

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
        const isPicked = showingReveal && pick?.seatId === chair.seatId;
        // The picked chair is drawn separately, risen and scaled.
        if (isPicked) continue;

        const dim = showingReveal;
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
      if (showingReveal && pick) {
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

        // --- reveal card: Malayalam title + risk score ---------------------
        // Pops in with an overshoot and a damped wiggle, then settles. Title and
        // score share one card so they read as a single focal point rather than
        // two competing labels.
        const cap = captionTransform(elapsed);

        if (phase === 'forceLocked' && cap.visible) {
          // ---- final screen state: one huge caption, nothing competing --------
          // Deliberately NOT the score card. This is the end of the turn, so the
          // caption is the whole screen rather than a line inside a panel.
          const scrim = 0.55 * cap.alpha;
          ctx.fillStyle = withAlpha(palette.bg, scrim);
          ctx.fillRect(0, 0, d.cssW, d.cssH);

          // Sized to the frame, then shrunk if it would touch the edges, so a long
          // caption or a narrow window cannot clip it.
          let bigPx = Math.max(40, Math.round(d.cssW * 0.062));
          const maxW = d.cssW * 0.86;
          ctx.font = playfulIntlFont(bigPx);
          if (ctx.measureText(FORCED_LOCK_TEXT).width > maxW) {
            bigPx = Math.floor(bigPx * (maxW / ctx.measureText(FORCED_LOCK_TEXT).width));
            ctx.font = playfulIntlFont(bigPx);
          }

          const subPx = Math.max(11, Math.round(d.cssW * 0.0125));
          // Clamped so the caption and the line beneath it always fit in frame.
          // The tilt and the pop-in overshoot both push past the nominal box, hence
          // the generous allowance rather than exactly half the cap height.
          const below = bigPx * 0.78 + subPx;
          const cy = Math.min(d.cssH * 0.66, d.cssH - below - bigPx * 0.4);

          ctx.save();
          ctx.translate(d.cssW / 2, cy);
          // A touch of tilt and the pop-in overshoot: dramatic, not static.
          ctx.rotate(-0.022 + cap.rotation * 0.5);
          ctx.scale(cap.scale, cap.scale);
          ctx.globalAlpha = cap.alpha;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Layered glow, then a dark outline, then the fill. The outline is what
          // keeps it readable where it crosses the bright chair halo.
          ctx.shadowColor = withAlpha(palette.playful, 0.95);
          ctx.shadowBlur = bigPx * 0.55;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = withAlpha(palette.bg, 0.9);
          ctx.lineWidth = Math.max(6, bigPx * 0.13);
          ctx.strokeText(FORCED_LOCK_TEXT, 0, 0);

          ctx.shadowBlur = bigPx * 0.3;
          ctx.fillStyle = palette.playfulBright;
          ctx.fillText(FORCED_LOCK_TEXT, 0, 0);
          ctx.restore();

          // The seat is still the outcome, so it stays — small, under the caption,
          // subordinate to it rather than boxed up beside it.
          const sub = `${pick.seatId} · LOCKED · ${
            reveal?.score == null ? '--/100' : formatScore(reveal.score)
          }`;
          ctx.save();
          ctx.globalAlpha = cap.alpha;
          ctx.font = monoFont(subPx, 'bold');
          ctx.fillStyle = withAlpha(palette.textBright, 0.75);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(sub, d.cssW / 2, cy + bigPx * 0.78);
          ctx.restore();
        } else if (cap.visible) {
          const titlePx = Math.max(20, Math.round(d.cssW * 0.030));
          const scorePx = Math.max(26, Math.round(d.cssW * 0.040));
          const labelPx = Math.max(9, Math.round(d.cssW * 0.0105));

          const scoreText = reveal?.score === null || reveal === null
            ? '--/100'
            : formatScore(reveal.score);

          // forceLocked never reaches here — it has its own full-screen treatment
          // above. Exactly one caption is ever on screen.
          const title = phase === 'locked' ? REVEAL_TEXT : REVEAL_TITLE;

          // Malayalam-capable stack: Comic Sans carries no Malayalam glyphs, so
          // without the fallback this measures and paints as tofu boxes.
          ctx.font = playfulIntlFont(titlePx);
          const titleW = ctx.measureText(title).width;
          ctx.font = monoFont(scorePx, 'bold');
          const scoreW = ctx.measureText(scoreText).width;
          ctx.font = monoFont(labelPx, 'bold');
          const labelW = ctx.measureText(RISK_LABEL).width;

          // The question rides on the card so it is next to the score, with the
          // Yes/No buttons answering it. Smaller than the title: it is a prompt,
          // not the punchline.
          const promptPx = Math.round(titlePx * 0.66);
          ctx.font = playfulIntlFont(promptPx);
          const promptW = promptVisible ? ctx.measureText(CONFIRM_PROMPT).width : 0;

          const padX = Math.round(titlePx * 0.8);
          const boxW = Math.max(titleW, scoreW, labelW, promptW) + padX * 2;

          // Stacked from the top so adding the prompt row cannot overlap the score.
          const rowTitle = titlePx * 1.5;
          const rowLabel = labelPx * 2.2;
          const rowScore = scorePx * 1.25;
          const rowPrompt = promptVisible ? promptPx * 1.7 : 0;
          const boxH = Math.round(rowTitle + rowLabel + rowScore + rowPrompt);

          // Clamp the CENTRE, not a corner, so scaling about the centre stays put.
          let ccx = bcx;
          let ccy = y - boxH / 2 - 14;
          ccx = Math.max(boxW / 2 + 4, Math.min(d.cssW - boxW / 2 - 4, ccx));
          if (ccy - boxH / 2 < 4) {
            ccy = Math.min(d.cssH - boxH / 2 - 4, y + h + boxH / 2 + 14);
          }

          ctx.save();
          ctx.translate(ccx, ccy);
          ctx.rotate(cap.rotation);
          ctx.scale(cap.scale, cap.scale);
          ctx.globalAlpha = cap.alpha;

          roundedRectPath(ctx, -boxW / 2, -boxH / 2, boxW, boxH, Math.round(titlePx * 0.5));
          ctx.fillStyle = withAlpha(palette.playfulDeep, 0.95);
          ctx.fill();
          ctx.strokeStyle = palette.playful;
          ctx.lineWidth = 2.5;
          ctx.stroke();

          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Title on top — the fun focal point.
          ctx.font = playfulIntlFont(titlePx);
          ctx.fillStyle = palette.playfulBright;
          ctx.fillText(title, 0, -boxH / 2 + titlePx * 0.95);

          // Small caps label, then the number. Mono for the number because it is
          // data, and it keeps digits from shifting width as the score changes.
          const top = -boxH / 2;
          ctx.font = monoFont(labelPx, 'bold');
          ctx.fillStyle = withAlpha(palette.playfulBright, 0.7);
          ctx.fillText(RISK_LABEL, 0, top + rowTitle + labelPx * 0.9);

          ctx.font = monoFont(scorePx, 'bold');
          ctx.fillStyle = palette.textBright;
          ctx.fillText(scoreText, 0, top + rowTitle + rowLabel + scorePx * 0.7);

          // The question, last, directly above the Yes/No buttons in the nav row.
          if (promptVisible) {
            ctx.font = playfulIntlFont(promptPx);
            ctx.fillStyle = withAlpha(palette.textBright, 0.92);
            ctx.fillText(
              CONFIRM_PROMPT,
              0,
              top + rowTitle + rowLabel + rowScore + promptPx * 0.85,
            );
          }

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
    [phase, showingReveal, pick, reveal, autoEnabled, scan.running],
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
        <button className="primary" onClick={beginTurn}>
          Start Music
        </button>
        <button
          className={autoEnabled ? 'on' : ''}
          onClick={() => setAutoEnabled((v) => !v)}
          aria-pressed={autoEnabled}
        >
          Auto {autoEnabled ? 'On' : 'Off'}
        </button>
        {/* Gated on `awaitingAnswer` alone — nothing about which selection this is,
            so it appears on the 1st, 2nd and 3rd identically. On the 3rd, No leads
            to the force-lock instead of another round; the prompt itself is the
            same. Withdrawn only once the seat is settled. */}
        {/* Just the two answers here. The question itself is on the reveal card,
            where the user is already looking — repeating it in the nav strip put
            the same Malayalam line on screen twice. */}
        {promptVisible && (
          <>
            <button className="primary" onClick={confirmSeat}>
              {CONFIRM_YES}
            </button>
            <button onClick={rejectSeat}>{CONFIRM_NO}</button>
          </>
        )}
      </div>

      <LiveStage
        stream={stream}
        frameWidth={frameWidth}
        frameHeight={frameHeight}
        draw={draw}
        animate={phase === 'playing' || showingReveal}
        cursor="default"
      />

      {/* Canvas text is invisible to assistive tech, so the outcome is mirrored
          into a live region. Not visible copy. */}
      <p className="sr-only" aria-live="polite">
        {showingReveal && pick
          ? phase === 'forceLocked'
            ? `${pick.seatId} force-locked. ${FORCED_LOCK_TEXT}. No redos left.`
            : phase === 'locked'
              ? `${pick.seatId} locked in. ${REVEAL_TEXT}.`
              : `Selection ${selectionNumber(redoUsed)}: ${pick.seatId}. ${CONFIRM_PROMPT} ${CONFIRM_YES} to lock it in, ${CONFIRM_NO} to try again. ${redosLeft(redoUsed)} redos left.`
          : ''}
      </p>
    </>
  );
}
