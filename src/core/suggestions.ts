import { improvement } from './scoreDisplay';
import type { SeatRuntimeState, SeatSuggestion, SuggestionSet } from '../models/types';

// ===========================================================================
// SUGGESTION CONSTANTS
// ===========================================================================

/**
 * Minimum score gap, in points, before a seat is worth suggesting.
 *
 * Below this the "improvement" is inside the noise floor of the scoring itself
 * — box jitter alone moves a score by a few points tick to tick — so flagging
 * it would be advising someone to move across a room for nothing.
 */
export const MIN_SCORE_GAP = 15;

/** Keep at most this many ranked candidates per occupied seat. */
export const MAX_SUGGESTIONS = 3;

/**
 * Consecutive ticks a new challenger must stay top before it replaces the
 * displayed pick.
 *
 * This is the anti-flicker mechanism. Two near-tied alternatives will trade
 * places constantly as scores jitter; without hysteresis the callout would
 * swap targets every tick and be unreadable.
 */
export const SUGGESTION_STABILITY_TICKS = 3;

// ===========================================================================

/**
 * Part I — the comparison pass.
 *
 * This has to run AFTER every chair in the tick has been scored, because it is
 * inherently a whole-room comparison: you cannot know a seat is worth moving to
 * without every other seat's score in hand.
 *
 * Only EMPTY chairs are ever suggested. Suggesting an occupied one would be
 * advising the user to displace a classmate, which is both antisocial and
 * useless as a plan.
 */
/** Full ranked alternative set for one occupied seat, before display capping. */
export interface RankedAlternatives {
  seatId: string;
  /**
   * EVERY empty seat that clears the gap threshold, best first — not just the
   * top few.
   *
   * The distinction matters to the debouncer. "Is my displayed pick still a
   * valid seat to move to" and "is it still in the top 3" are different
   * questions, and conflating them breaks the debounce: any re-ranking that
   * pushed the current pick to 4th place would look like the seat had vanished
   * and trigger an immediate swap. The full list answers the first question;
   * `SuggestionSet.candidates` answers the second.
   */
  ranked: SeatSuggestion[];
}

export function computeSuggestions(
  seatStates: readonly SeatRuntimeState[],
  minGap = MIN_SCORE_GAP,
): RankedAlternatives[] {
  const empties = seatStates.filter((s) => !s.occupied);
  const occupied = seatStates.filter((s) => s.occupied);

  return occupied.map((current) => {
    const ranked: SeatSuggestion[] = [];

    for (const empty of empties) {
      const gap = improvement(empty.visibilityScore, current.visibilityScore);
      if (gap < minGap) continue;
      ranked.push({
        targetSeatId: empty.seatId,
        targetScore: empty.visibilityScore,
        currentScore: current.visibilityScore,
        gap,
        rank: 0,
      });
    }

    // Biggest improvement first. Ties broken by seat id so the ordering is
    // deterministic rather than dependent on detection order — otherwise the
    // debouncer would see phantom changes between identical rankings.
    ranked.sort((a, b) => b.gap - a.gap || a.targetSeatId.localeCompare(b.targetSeatId));
    ranked.forEach((c, i) => (c.rank = i + 1));

    return { seatId: current.seatId, ranked };
  });
}

/**
 * Debouncer for the DISPLAYED pick.
 *
 * Design notes on the asymmetries, which are deliberate:
 *
 *  - First adoption is IMMEDIATE. Showing nothing for three ticks while we wait
 *    for confidence is worse than showing a possibly-suboptimal seat now.
 *  - Replacing an existing pick requires SUGGESTION_STABILITY_TICKS of the
 *    challenger holding first place. This is what stops the flicker.
 *  - Invalidation is IMMEDIATE. If the displayed seat gets occupied, disappears,
 *    or falls below the gap threshold, it is dropped that same tick. A stale
 *    suggestion pointing at a seat someone just took is worse than no
 *    suggestion at all.
 *  - The displayed pick's NUMBERS refresh every tick even when the pick itself
 *    is held. The target is debounced; the score reading is live.
 */
export class SuggestionStabiliser {
  private state = new Map<
    string,
    { displayedId?: string; challengerId?: string; streak: number }
  >();

  constructor(private stabilityTicks = SUGGESTION_STABILITY_TICKS) {}

  update(
    fresh: readonly RankedAlternatives[],
    maxSuggestions = MAX_SUGGESTIONS,
  ): SuggestionSet[] {
    const liveSeatIds = new Set(fresh.map((f) => f.seatId));

    // Drop bookkeeping for seats that are no longer occupied.
    for (const seatId of [...this.state.keys()]) {
      if (!liveSeatIds.has(seatId)) this.state.delete(seatId);
    }

    return fresh.map(({ seatId, ranked }) => {
      const st = this.state.get(seatId) ?? { streak: 0 };

      // Validity is checked against the FULL ranked set, not the display slice.
      // A pick that slipped from 1st to 4th is still a perfectly good seat and
      // must stay displayed; only a pick that stopped qualifying entirely — got
      // occupied, vanished from the feed, or fell under the gap threshold — is
      // invalidated, and that happens immediately rather than being debounced.
      const validIds = new Set(ranked.map((c) => c.targetSeatId));
      if (st.displayedId && !validIds.has(st.displayedId)) {
        st.displayedId = undefined;
        st.challengerId = undefined;
        st.streak = 0;
      }

      const freshTop = ranked[0]?.targetSeatId;

      if (!freshTop) {
        st.displayedId = undefined;
        st.challengerId = undefined;
        st.streak = 0;
      } else if (st.displayedId === undefined) {
        st.displayedId = freshTop;
        st.challengerId = undefined;
        st.streak = 0;
      } else if (st.displayedId === freshTop) {
        // Incumbent still winning; reset any challenger's progress.
        st.challengerId = undefined;
        st.streak = 0;
      } else if (st.challengerId === freshTop) {
        st.streak += 1;
        if (st.streak >= this.stabilityTicks) {
          st.displayedId = freshTop;
          st.challengerId = undefined;
          st.streak = 0;
        }
      } else {
        st.challengerId = freshTop;
        st.streak = 1;
      }

      this.state.set(seatId, st);

      return {
        seatId,
        candidates: ranked.slice(0, maxSuggestions),
        totalAlternatives: ranked.length,
        // Looked up in the FULL set so a held pick keeps live numbers even while
        // sitting outside the displayed top slice.
        displayed: ranked.find((c) => c.targetSeatId === st.displayedId),
        challengerId: st.challengerId,
        challengerStreak: st.streak,
      };
    });
  }

  reset(): void {
    this.state.clear();
  }
}
