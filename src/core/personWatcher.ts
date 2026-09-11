import type { TickResult } from '../models/types';

// ===========================================================================
// AUTO-TRIGGER CONSTANTS
// ===========================================================================

/**
 * Ticks observed before new-person events start firing.
 *
 * This is the "already in the room" filter. People sitting in frame when the
 * scan starts must not count as *entering*, so the first few ticks only build a
 * baseline. It needs to be more than the tracker's own confirmation delay
 * (2 hits): someone present from the start whose detection flickers might not be
 * confirmed until tick 3 or 4, and firing on them would be wrong.
 *
 * At ~1.5Hz this is roughly 2.7 seconds of blind spot after pressing Scan.
 */
export const WARMUP_TICKS = 4;

/**
 * Quiet period after a round completes before auto-trigger re-arms.
 *
 * Without it, a group walking in together would each fire a round back to back
 * and the reveal would be wiped before anyone could read it.
 */
export const AUTO_COOLDOWN_MS = 5000;

/**
 * Ticks after which a departed person's id is forgotten. Purely to bound memory
 * — the tracker never reuses ids within a session, so a pruned id cannot come
 * back and be mistaken for a new arrival.
 */
const PRUNE_AFTER_TICKS = 40;

// ===========================================================================

/**
 * Detects a NEW person entering frame, reusing the existing person-track ids.
 *
 * "New" means an id we have not seen before — not "a person is visible". Because
 * ids come from the shared CentroidTracker, a person who stays seated keeps one
 * id forever and fires once, not every tick.
 *
 * Only CONFIRMED tracks count. The tracker requires consecutive sightings before
 * confirming, which filters the single-frame false positives that would otherwise
 * trigger rounds at random.
 */
export class NewPersonWatcher {
  private seen = new Map<string, number>();
  private lastTick = 0;
  private ticksObserved = 0;

  /**
   * Record a tick and return any newly-arrived person ids.
   *
   * Idempotent per tick: calling it twice with the same TickResult returns an
   * empty list the second time and does not double-count. That matters because
   * the caller is a React effect which can re-run for reasons unrelated to a new
   * tick arriving.
   */
  observe(result: TickResult): string[] {
    // Tick numbers restart when the scan engine restarts, and person ids are
    // reallocated from zero with it. Treat that as a fresh session.
    if (result.tick < this.lastTick) this.reset();
    if (result.tick <= this.lastTick) return [];

    this.lastTick = result.tick;
    this.ticksObserved += 1;

    const warm = this.ticksObserved > WARMUP_TICKS;
    const arrivals: string[] = [];

    for (const person of result.people) {
      if (!person.confirmed) continue;
      if (!this.seen.has(person.id) && warm) arrivals.push(person.id);
      this.seen.set(person.id, result.tick);
    }

    for (const [id, tick] of this.seen) {
      if (result.tick - tick > PRUNE_AFTER_TICKS) this.seen.delete(id);
    }

    return arrivals;
  }

  reset(): void {
    this.seen.clear();
    this.lastTick = 0;
    this.ticksObserved = 0;
  }

  /** False while still building the baseline. */
  get isWarm(): boolean {
    return this.ticksObserved > WARMUP_TICKS;
  }

  get knownCount(): number {
    return this.seen.size;
  }

  get ticksSeen(): number {
    return this.ticksObserved;
  }
}
