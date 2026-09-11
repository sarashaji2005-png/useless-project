import type { TickResult, TrackClass } from '../models/types';
import { CHAIR_MIN_SCORE, PERSON_MIN_SCORE } from '../detect/detector';
import { formatScore, formatScoreShort } from './scoreDisplay';
import { MIN_SCORE_GAP } from './suggestions';

/**
 * Part G — staged diagnostics.
 *
 * The specific failure this exists to prevent: "nothing shows up on the feed"
 * with no way to tell which stage went empty. Every tick logs a line per stage
 * in pipeline order, so the first zero in the chain is the culprit:
 *
 *   model returned N  ->  above threshold N  ->  tracked N  ->  confirmed N
 *   ->  occupied N  ->  scored N
 *
 * `bestChairScore` is called out separately because the single most likely
 * cause of an empty overlay is real chairs being detected just below
 * CHAIR_MIN_SCORE. If that number is 0.18 and the threshold is 0.2, the fix is
 * obvious and takes one edit.
 */

export const DIAGNOSTICS_ENABLED = true;

export interface DiagnosticLine {
  stage: string;
  value: string;
  /** Drawn amber on the overlay — this stage is where the pipeline went empty. */
  suspect: boolean;
}

export function logTick(result: TickResult, bestChairScore: number): void {
  if (!DIAGNOSTICS_ENABLED) return;

  const s = result.stats;
  const label = `[hidenseat] tick ${result.tick}`;

  // Collapsed group so a long scan does not bury the console.
  console.groupCollapsed(
    `${label} — chairs ${s.confirmedChairs}/${s.trackedChairs} · people ${s.confirmedPeople}/${s.trackedPeople} · occupied ${s.occupiedChairs} · scored ${s.scoredChairs} · ${s.totalMs}ms`,
  );
  console.log('1. model returned      :', s.rawDetections, `(chair ${s.rawChairs}, person ${s.rawPeople})`);
  console.log(
    '2. above threshold    :',
    `chair ${s.chairsAboveThreshold} (min ${CHAIR_MIN_SCORE})`,
    `person ${s.peopleAboveThreshold} (min ${PERSON_MIN_SCORE})`,
  );
  console.log('   best chair score   :', bestChairScore.toFixed(3));
  console.log('3. tracked            :', `chair ${s.trackedChairs}, person ${s.trackedPeople}`);
  console.log('4. confirmed          :', `chair ${s.confirmedChairs}, person ${s.confirmedPeople}`);
  console.log('5. occupied chairs    :', s.occupiedChairs);
  console.log('6. teacher point      :', result.teacherPoint ? `set (${result.teacherPoint.x.toFixed(0)}, ${result.teacherPoint.y.toFixed(0)})` : 'NOT SET — no scores possible');
  console.log('7. scored chairs      :', s.scoredChairs);
  console.log(
    '8. suggestions shown  :',
    `${s.seatsWithSuggestions}/${s.occupiedChairs} occupied seats (min gap ${MIN_SCORE_GAP} pts)`,
  );
  console.log('   inference / total  :', `${s.inferenceMs.toFixed(0)}ms / ${s.totalMs}ms`);

  if (result.seatStates.length > 0) {
    console.table(
      result.seatStates
        .slice()
        .sort((a, b) => a.visibilityScore - b.visibilityScore)
        .map((st) => ({
          seat: st.seatId,
          score: formatScore(st.visibilityScore),
          base: formatScoreShort(st.baseScore),
          'lost to occlusion': Math.round(st.baseScore - st.visibilityScore),
          blockers: st.blockers.length,
          dominant: st.occlusionSource ?? '—',
          occupied: st.occupied,
          offAxis: `${st.offAxisDeg.toFixed(0)}°`,
        })),
    );
  }

  // Suggestions get their own table, including the debouncer's internal state.
  // If a callout looks stuck on a worse option, `challenger` and `streak` show
  // whether a swap is mid-flight or whether the ranking genuinely is not moving.
  const withPicks = result.suggestions.filter((x) => x.displayed);
  if (withPicks.length > 0) {
    console.table(
      withPicks.map((x) => ({
        occupied: x.seatId,
        'current score': formatScoreShort(x.displayed!.currentScore),
        'suggested seat': x.displayed!.targetSeatId,
        'suggested score': formatScoreShort(x.displayed!.targetScore),
        'gap (pts)': Math.round(x.displayed!.gap),
        'rank now': x.displayed!.rank,
        alternatives: x.totalAlternatives,
        challenger: x.challengerId ?? '—',
        streak: x.challengerStreak,
      })),
    );
  }
  console.groupEnd();
}

/**
 * The same chain, condensed for on-canvas display. The overlay is the only UI
 * left, so this has to live there rather than in a panel.
 */
export function buildOverlayDiagnostics(
  result: TickResult | null,
  bestChairScore: number,
): DiagnosticLine[] {
  if (!result) {
    return [{ stage: 'status', value: 'no tick yet', suspect: true }];
  }
  const s = result.stats;

  return [
    {
      stage: 'model',
      value: `${s.rawDetections} (ch ${s.rawChairs} / pe ${s.rawPeople})`,
      suspect: s.rawDetections === 0,
    },
    {
      stage: 'threshold',
      value: `ch ${s.chairsAboveThreshold} @${CHAIR_MIN_SCORE} · best ${bestChairScore.toFixed(2)}`,
      suspect: s.rawChairs > 0 && s.chairsAboveThreshold === 0,
    },
    {
      stage: 'tracked',
      value: `ch ${s.confirmedChairs}/${s.trackedChairs} · pe ${s.confirmedPeople}/${s.trackedPeople}`,
      suspect: s.chairsAboveThreshold > 0 && s.trackedChairs === 0,
    },
    {
      stage: 'occupied',
      value: `${s.occupiedChairs}/${s.confirmedChairs}`,
      suspect: false,
    },
    {
      stage: 'teacher',
      value: result.teacherPoint ? 'set' : 'NOT SET — click the feed',
      suspect: !result.teacherPoint,
    },
    {
      stage: 'scored',
      value: `${s.scoredChairs}`,
      suspect: s.confirmedChairs > 0 && s.scoredChairs === 0,
    },
    {
      stage: 'suggested',
      value: `${s.seatsWithSuggestions}/${s.occupiedChairs} occ`,
      suspect: false,
    },
    {
      stage: 'timing',
      value: `${s.inferenceMs.toFixed(0)}ms inf · ${s.totalMs}ms tick`,
      suspect: s.totalMs > 900,
    },
  ];
}

/**
 * Raw per-detection dump, before per-class thresholding.
 *
 * RECONSTRUCTED — this export was called by useScanEngine.ts but missing from
 * disk, which was one of the two build breaks. The signature is pinned by its
 * only call site, `logRawDetections(result.tick, raw.scored)`.
 *
 * Why it exists separately from logTick: the tick log tells you a stage came out
 * empty, but not WHY. This distinguishes "the model saw nothing" from "the model
 * saw it and we threw it away just under the cut", which are the same symptom and
 * opposite fixes. NEAR MISSES are called out explicitly because that is the one
 * case where the answer is simply to lower a threshold.
 */
export function logRawDetections(
  tick: number,
  scored: readonly { cls: TrackClass; score: number; kept: boolean }[],
): void {
  if (!DIAGNOSTICS_ENABLED) return;
  if (scored.length === 0) {
    console.log(`[hidenseat] tick ${tick} — model returned nothing at all`);
    return;
  }

  const threshold: Record<TrackClass, number> = {
    chair: CHAIR_MIN_SCORE,
    person: PERSON_MIN_SCORE,
  };

  /** Dropped, but within 0.08 of its threshold — i.e. probably a real object. */
  const NEAR_MISS_BAND = 0.08;
  const nearMisses = scored.filter(
    (s) => !s.kept && s.score >= threshold[s.cls] - NEAR_MISS_BAND,
  );

  const kept = scored.filter((s) => s.kept).length;

  console.groupCollapsed(
    `[hidenseat] tick ${tick} raw — ${scored.length} returned, ${kept} kept` +
      (nearMisses.length > 0 ? `, ${nearMisses.length} NEAR MISS` : ''),
  );
  console.table(
    [...scored]
      .sort((a, b) => b.score - a.score)
      .map((s) => ({
        class: s.cls,
        score: s.score.toFixed(3),
        threshold: threshold[s.cls].toFixed(2),
        kept: s.kept,
        verdict: s.kept
          ? 'kept'
          : s.score >= threshold[s.cls] - NEAR_MISS_BAND
            ? 'NEAR MISS — consider lowering the threshold'
            : 'dropped',
      })),
  );
  console.groupEnd();
}
