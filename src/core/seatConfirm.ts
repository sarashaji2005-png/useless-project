/**
 * The seat confirm / redo wrapper — the single consolidated version.
 *
 * Supersedes both earlier attempts at this flow: the original confirm/redo spec
 * and the later rescan-only spec. Neither survives — `src/core/rescan.ts` is
 * deleted and both retired ending captions are gone with it. `verifyRounds`
 * scans `src/` to keep them from creeping back.
 *
 * Kept as pure functions rather than inline `if`s in the component because the
 * off-by-one IS the feature: two redos are allowed, and the THIRD rejection is
 * refused, so the Reject control has to stay pressable at 0 left — otherwise the
 * user has nothing to reject *with* and the force-lock beat can never happen.
 * Buried in JSX that is unverifiable without a camera; here it is assertable.
 *
 * This wrapper knows nothing about detection, scoring, or how a chair is chosen.
 * It only counts rejections and decides which of the two end-states applies.
 */

/** Redos allowed per person's turn. The 3rd rejection force-locks instead. */
export const REDO_LIMIT = 2;

/**
 * Caption when the user is out of redos and the 3rd chair is force-locked.
 *
 * Hard stop: no buttons after this. This is the ONLY ending caption in the flow;
 * both earlier versions' endings are retired.
 */
export const FORCED_LOCK_TEXT = 'MADUTHILLE BROO';

export type RedoAction =
  /** Re-run the existing round. `count` is the new used-redo count. */
  | { kind: 'redo'; count: number }
  /** Out of redos: lock the chair currently shown and stop. */
  | { kind: 'forceLock' };

/**
 * What pressing Reject should do, given how many redos this turn has used.
 *
 * `used` 0 -> redo (2nd selection), 1 -> redo (3rd selection), 2 -> force-lock.
 */
export function nextRedoAction(used: number): RedoAction {
  return used < REDO_LIMIT ? { kind: 'redo', count: used + 1 } : { kind: 'forceLock' };
}

/**
 * Whether the confirm/reject pair should be offered.
 *
 * True right up to and including the spent state, because the force-lock is a beat
 * the user triggers by rejecting a third time, not something that appears on its
 * own. False once the seat is settled either way.
 */
export function canOfferRedo(used: number, settled: boolean): boolean {
  return !settled && used <= REDO_LIMIT;
}

/** Redos left, for the button label. Never negative. */
export function redosLeft(used: number): number {
  return Math.max(0, REDO_LIMIT - used);
}

/** Which selection the user is looking at: 1st, 2nd or 3rd. */
export function selectionNumber(used: number): number {
  return used + 1;
}
