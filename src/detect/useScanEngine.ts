import { useCallback, useEffect, useRef, useState } from 'react';
import { CentroidTracker, resetIdCounter } from '../core/tracker';
import { computeOccupancy } from '../core/occupancy';
import { computeScreenVisibility, inferFacingDeg } from '../core/screenVisibility';
import { computeSuggestions, SuggestionStabiliser } from '../core/suggestions';
import { logRawDetections, logTick } from '../core/diagnostics';
import { roomReferencePoint } from '../core/roomConfig';
import { detectFrame, loadDetector, type DetectorStatus } from './detector';
import type { Point, TickResult } from '../models/types';

/**
 * The scan loop.
 *
 * setInterval, NOT requestAnimationFrame. rAF fires at display rate and is for
 * rendering; we want ~1.5Hz. Chairs do not move sixty times a second, and
 * running inference at display rate would melt a laptop that is also driving a
 * projector.
 *
 * A re-entrancy guard is essential: on a slow machine one inference can outlast
 * the interval, and without the guard ticks queue up until the UI stalls.
 */

export const SCAN_INTERVAL_MS = 667; // ~1.5Hz

export interface ScanEngineState {
  running: boolean;
  detectorStatus: DetectorStatus;
  error?: string;
  lastResult: TickResult | null;
  bestChairScore: number;
  /** Fixed front-of-room reference. Always present now — see core/roomConfig. */
  teacherPoint: Point;
  /** Facing used for the cone. Inferred from chair positions unless overridden. */
  facingDeg: number;
}

export function useScanEngine(grabFrame: () => HTMLCanvasElement | null) {
  const chairTracker = useRef(new CentroidTracker('chair'));
  const personTracker = useRef(new CentroidTracker('person'));
  const stabiliser = useRef(new SuggestionStabiliser());
  const busy = useRef(false);
  const tickNo = useRef(0);


  const [state, setState] = useState<ScanEngineState>({
    running: false,
    detectorStatus: 'idle',
    lastResult: null,
    bestChairScore: 0,
    teacherPoint: { x: 0, y: 0 },
    facingDeg: 90,
  });

  const tick = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const t0 = performance.now();

    try {
      const frame = grabFrame();
      if (!frame) return;

      const model = await loadDetector();
      const raw = await detectFrame(model, frame);

      const chairs = chairTracker.current.update(raw.detections, frame.width, frame.height);
      const people = personTracker.current.update(raw.detections, frame.width, frame.height);

      // Only confirmed tracks take part in occupancy and scoring. Unconfirmed
      // ones are still returned so the overlay can draw them faintly — an
      // object that is being detected but not yet trusted should be visible,
      // otherwise "nothing shows up" is ambiguous.
      const confirmedChairs = chairs.filter((t) => t.confirmed);
      const confirmedPeople = people.filter((t) => t.confirmed);

      const now = Date.now();
      const occupancy = computeOccupancy(confirmedChairs, confirmedPeople, now);

      // Fixed reference point instead of a user click. Derived from frame size, so
      // it lands in the same relative spot at any camera resolution.
      const teacherPoint = roomReferencePoint(frame.width, frame.height);

      // Cone direction is inferred from where the chairs actually are, rather than
      // asking for a second click. Falls back to facing down-frame with no chairs.
      const facingDeg = inferFacingDeg(teacherPoint, confirmedChairs);

      // No longer gated on anything: every confirmed chair is always scored.
      const seatStates = computeScreenVisibility({
        teacherPoint,
        facingDeg,
        chairs: confirmedChairs,
        people: confirmedPeople,
        occupantsByChair: occupancy.byChair,
        frameWidth: frame.width,
        frameHeight: frame.height,
      });

      // Runs strictly AFTER scoring: it is a whole-room comparison, so it needs
      // every chair's score, not one seat in isolation.
      const suggestions = stabiliser.current.update(computeSuggestions(seatStates));

      tickNo.current += 1;
      const result: TickResult = {
        tick: tickNo.current,
        capturedAt: now,
        chairs,
        people,
        occupants: occupancy.occupants,
        seatStates,
        suggestions,
        teacherPoint,
        stats: {
          rawDetections: raw.totalReturned,
          rawChairs: raw.rawChairs,
          rawPeople: raw.rawPeople,
          chairsAboveThreshold: raw.detections.filter((d) => d.cls === 'chair').length,
          peopleAboveThreshold: raw.detections.filter((d) => d.cls === 'person').length,
          trackedChairs: chairs.length,
          confirmedChairs: confirmedChairs.length,
          trackedPeople: people.length,
          confirmedPeople: confirmedPeople.length,
          occupiedChairs: occupancy.occupants.length,
          scoredChairs: seatStates.length,
          seatsWithSuggestions: suggestions.filter((s) => s.displayed).length,
          inferenceMs: raw.inferenceMs,
          totalMs: Math.round(performance.now() - t0),
        },
      };

      logRawDetections(result.tick, raw.scored);
      logTick(result, raw.bestChairScore);

      setState((s) => ({
        ...s,
        lastResult: result,
        bestChairScore: raw.bestChairScore,
        facingDeg,
        detectorStatus: 'ready',
        error: undefined,
      }));
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      console.error('[hidenseat] tick failed:', err);
      setState((s) => ({ ...s, detectorStatus: 'failed', error: message }));
    } finally {
      busy.current = false;
    }
  }, [grabFrame]);

  const start = useCallback(async () => {
    resetIdCounter();
    chairTracker.current.reset();
    personTracker.current.reset();
    stabiliser.current.reset();
    tickNo.current = 0;

    setState((s) => ({ ...s, detectorStatus: 'loading', error: undefined, lastResult: null }));
    try {
      await loadDetector();
      setState((s) => ({ ...s, detectorStatus: 'ready', running: true }));
    } catch (err) {
      setState((s) => ({
        ...s,
        detectorStatus: 'failed',
        error: (err as Error)?.message ?? String(err),
      }));
    }
  }, []);

  /**
   * Stop leaves `lastResult` intact on purpose. The frozen frame keeps showing
   * the last computed scores, which is both the requested behaviour and the
   * demo-safe fallback if live detection starts misbehaving on stage.
   */
  const stop = useCallback(() => {
    setState((s) => ({ ...s, running: false }));
  }, []);

  useEffect(() => {
    if (!state.running) return;
    const id = window.setInterval(() => void tick(), SCAN_INTERVAL_MS);
    void tick(); // fire immediately rather than waiting out the first interval
    return () => window.clearInterval(id);
  }, [state.running, tick]);

  return { state, start, stop };
}
