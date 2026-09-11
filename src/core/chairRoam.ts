import type { ChairTarget, PickResult } from './chairPick';
import type { Point } from '../models/types';

// ===========================================================================
// ROAM CONSTANTS
// ===========================================================================

/**
 * Time between hops. Steady, not decelerating — the indicator is scanning the
 * room at a constant rate rather than winding down toward an answer, because the
 * answer is not decided until the music stops.
 */
export const HOP_INTERVAL_MS = 220;

/**
 * Worst-case cadence. The next hop is scheduled from the moment a hop actually
 * happens, so at 60fps the real interval is HOP_INTERVAL_MS plus up to one frame.
 * Documented so the "150-300ms" requirement can be checked against the real
 * upper bound rather than the nominal value.
 */
export const HOP_INTERVAL_MAX_MS = HOP_INTERVAL_MS + 17;

// ===========================================================================

/**
 * The roaming indicator.
 *
 * Two properties matter and are both deliberate:
 *
 *  1. THE LIST IS NEVER FROZEN. Every hop re-reads whatever chairs are currently
 *     tracked, so chairs appearing or disappearing through detection jitter are
 *     picked up immediately. A chair detected two seconds into the round is a
 *     valid hop target.
 *
 *  2. POSITION IS RESOLVED BY ID, NOT CACHED. Between hops the indicator looks up
 *     its current seat's live box every frame, so it rides along as the tracker
 *     nudges that box rather than sitting at a stale coordinate.
 *
 * Plain class, no React or DOM: the component drives it from requestAnimationFrame
 * and the verification script drives it from a loop, both exercising the same code.
 */
export class ChairRoam {
  private seatId: string | null = null;
  private nextHopAtMs: number;
  private landedAt: Point | null = null;
  private hops = 0;

  constructor(
    startedAtMs: number,
    private readonly rng: () => number = Math.random,
    private readonly hopIntervalMs: number = HOP_INTERVAL_MS,
  ) {
    // First hop fires immediately so the indicator appears the instant the music
    // starts rather than after a blank interval.
    this.nextHopAtMs = startedAtMs;
  }

  /** Seat the indicator is currently sitting on. */
  get currentSeatId(): string | null {
    return this.seatId;
  }

  get hopCount(): number {
    return this.hops;
  }

  /** True once land() has been called and roaming has stopped. */
  get isLanded(): boolean {
    return this.landedAt !== null;
  }

  /**
   * Advance to `nowMs` against the CURRENT chair list.
   *
   * Called every animation frame. Chairs are passed in fresh each time rather
   * than held, which is what keeps the roam synced to live detection.
   */
  update(nowMs: number, chairs: readonly ChairTarget[]): void {
    if (this.landedAt) return;

    if (chairs.length === 0) {
      // Nothing detected right now. Keep the current seat id so the indicator
      // resumes in place, and hold the deadline at `now` so no hop debt builds
      // up while detection is down — otherwise recovery fires a burst of hops.
      this.nextHopAtMs = nowMs;
      return;
    }

    // The seat we were on is no longer in the tracked list. Re-target at once
    // rather than pointing at a chair that is not being detected any more.
    const vanished = this.seatId !== null && !chairs.some((c) => c.seatId === this.seatId);

    if (nowMs >= this.nextHopAtMs || vanished) {
      this.seatId = this.chooseNext(chairs);
      this.hops += 1;
      // Scheduled from when the hop ACTUALLY happened, not from the deadline it
      // was due at. That caps this to one hop per update for free: a backgrounded
      // tab returning after 60s produces a single hop and resynchronises, instead
      // of replaying 300 missed hops in one frame. Costs a few ms of cadence
      // drift per hop, which is imperceptible and stays inside the target band.
      this.nextHopAtMs = nowMs + this.hopIntervalMs;
    }
  }

  /** Uniform among the current chairs, avoiding an immediate repeat. */
  private chooseNext(chairs: readonly ChairTarget[]): string {
    const choices =
      chairs.length > 1 && this.seatId !== null
        ? chairs.filter((c) => c.seatId !== this.seatId)
        : chairs;
    const pool = choices.length > 0 ? choices : chairs;
    // Math.min guards rng() === 1, which would index out of bounds.
    return pool[Math.min(pool.length - 1, Math.floor(this.rng() * pool.length))].seatId;
  }

  /**
   * Current screen position, resolved from the live chair list by id.
   *
   * Returns null when there is nothing to point at, which the caller renders as
   * "no indicator" rather than defaulting to a coordinate that means nothing.
   */
  position(chairs: readonly ChairTarget[]): Point | null {
    if (this.landedAt) return this.landedAt;
    if (this.seatId === null) return null;
    return chairs.find((c) => c.seatId === this.seatId)?.centre ?? null;
  }

  /**
   * Lock onto the selected chair and stop roaming.
   *
   * The landing coordinate is taken FROM the pick, so the indicator's final
   * position cannot disagree with the selection. Same guarantee as before: the
   * animation is an output of the decision, never an input to it.
   */
  land(pick: PickResult): void {
    this.seatId = pick.seatId;
    this.landedAt = pick.centre;
  }
}
