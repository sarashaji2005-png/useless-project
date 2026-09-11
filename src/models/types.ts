/**
 * Shared data models for Hide N Seat.
 *
 * COORDINATE SYSTEM — there is now only ONE that matters, which is the point
 * of the rework:
 *
 *   FRAME PIXEL space. Origin top-left of the camera frame, +x right, +y DOWN.
 *   Units: pixels of the source video frame (NOT displayed CSS pixels).
 *
 * All detection, tracking, occupancy and visibility math happens here. There
 * is no floor plane, no homography, no real-world centimetres on the default
 * path. Everything is measured against what the camera actually sees.
 *
 * The optional floor-calibration stretch path (see core/flags.ts) would
 * reintroduce a GRID space in centimetres, but it is gated off and unbuilt.
 */

/** Axis-aligned bounding box in frame pixels. Matches COCO-SSD's bbox layout. */
export interface Box {
  px: number;
  py: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The two COCO classes we care about. */
export type TrackClass = 'chair' | 'person';

/** A raw detection straight out of the detector, before tracking. */
export interface Detection {
  box: Box;
  score: number;
  cls: TrackClass;
}

/**
 * A detection given a stable identity across ticks.
 *
 * `id` is the whole point: it survives frame-to-frame jitter so a chair's
 * visibility score is a continuous reading rather than a fresh guess every
 * tick.
 */
export interface Track {
  id: string;
  cls: TrackClass;
  /** Smoothed box. Raw detection boxes jitter several pixels per tick. */
  box: Box;
  /** Latest raw box, unsmoothed. Kept for debugging jitter magnitude. */
  rawBox: Box;
  score: number;
  centroid: Point;
  /** Consecutive ticks seen. Drives promotion to `confirmed`. */
  hitStreak: number;
  /** Consecutive ticks missed. Drives eventual deletion. */
  missStreak: number;
  /** False until the track has been seen enough ticks to be trusted. */
  confirmed: boolean;
  firstTick: number;
  lastTick: number;
}

/**
 * Shared occupant model, carried over from the original design.
 *
 * `seatId` is now a CHAIR TRACK ID rather than a grid seat id — the camera
 * defines the seats.
 *
 * `estimatedHeightCm` is left undefined on the screen-space path, because
 * pixels cannot be converted to centimetres without a floor calibration.
 * Populating it with a fabricated number would be worse than leaving it empty.
 */
export interface Occupant {
  seatId: string;
  present: boolean;
  estimatedHeightCm?: number;
  detectedAt: number;
  /** Track id of the person occupying the chair. */
  personTrackId?: string;
  /** Which rule fired. Useful when tuning thresholds against real footage. */
  matchRule?: 'iou' | 'bottom-centre';
  matchIou?: number;
}

/** One blocker's contribution to a chair's occlusion. */
export interface BlockerContribution {
  trackId: string;
  cls: TrackClass;
  /** 0-1. Product of angular overlap and vertical overlap. */
  obstruction: number;
  /** Position along the teacher->chair segment where the blocker sits, 0-1. */
  t: number;
}

/** Shared per-tick runtime state, carried over from the original design. */
export interface SeatRuntimeState {
  seatId: string;
  /** 0-100, occlusion-adjusted. */
  visibilityScore: number;
  /** Track id of the dominant blocker, if any. */
  occlusionSource?: string;
  /** 0-100. Populated by feature 3, unused here. */
  luckScore?: number;

  // --- screen-space diagnostics -----------------------------------------
  /** Score before the occlusion penalty. */
  baseScore: number;
  /** Combined obstruction, 0-1, from 1 - product(1 - oᵢ). */
  obstruction: number;
  blockers: BlockerContribution[];
  offAxisDeg: number;
  distancePx: number;
  occupied: boolean;
}

/** One empty chair proposed as an alternative to an occupied one. */
export interface SeatSuggestion {
  /** The empty chair being suggested. Never an occupied one. */
  targetSeatId: string;
  targetScore: number;
  /** Score of the occupied seat this is an alternative to. */
  currentScore: number;
  /** Improvement in points under the active score semantics. Always positive. */
  gap: number;
  /** 1 = best candidate. */
  rank: number;
}

/** All suggestions for one occupied chair, plus the debounced display pick. */
export interface SuggestionSet {
  /** The occupied chair these suggestions are for. */
  seatId: string;
  /** Top-ranked candidates for display (capped), recomputed fresh every tick. */
  candidates: SeatSuggestion[];
  /** How many empty seats cleared the gap threshold in total, before capping. */
  totalAlternatives: number;
  /**
   * The pick actually shown on the overlay. Held stable across ticks by the
   * debouncer even while `candidates` churns.
   */
  displayed?: SeatSuggestion;
  /** Challenger currently building up consecutive wins, if any. */
  challengerId?: string;
  challengerStreak: number;
}

/** Everything one tick produces. */
export interface TickResult {
  tick: number;
  capturedAt: number;
  chairs: Track[];
  people: Track[];
  occupants: Occupant[];
  seatStates: SeatRuntimeState[];
  suggestions: SuggestionSet[];
  teacherPoint: Point | null;
  stats: TickStats;
}

export interface TickStats {
  rawDetections: number;
  rawChairs: number;
  rawPeople: number;
  chairsAboveThreshold: number;
  peopleAboveThreshold: number;
  trackedChairs: number;
  confirmedChairs: number;
  trackedPeople: number;
  confirmedPeople: number;
  occupiedChairs: number;
  scoredChairs: number;
  /** Occupied seats that have at least one worthwhile alternative. */
  seatsWithSuggestions: number;
  inferenceMs: number;
  totalMs: number;
}
