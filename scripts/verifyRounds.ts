/**
 * Verification for the Screen 2 round: uniform random chair selection, the
 * vacant-then-all fallback, and the rising reveal transform.
 *
 * Run: npm run verify:rounds
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canOfferRedo,
  CONFIRM_NO,
  CONFIRM_PROMPT,
  CONFIRM_YES,
  FORCED_LOCK_TEXT,
  nextRedoAction,
  REDO_LIMIT,
  redosLeft,
  SELECTIONS_PER_TURN,
  selectionNumber,
} from '../src/core/seatConfirm';
import {
  CAPTION_DELAY_MS,
  CAPTION_MS,
  CAPTION_WIGGLE_RAD,
  captionTransform,
  easeOutBack,
  easeOutCubic,
  pickRandomChair,
  PULSE_PERIOD_MS,
  PULSE_SCALE_AMOUNT,
  pulseScale,
  pulseUnit,
  REVEAL_MS,
  REVEAL_TEXT,
  RISE_FACTOR,
  RISE_SCALE,
  riseTransform,
  SHOCKWAVE_PERIOD_MS,
  shockwavePhase,
  trackedChairs,
  vacantChairs,
} from '../src/core/chairPick';
import {
  AUTO_COOLDOWN_MS,
  NewPersonWatcher,
  WARMUP_TICKS,
} from '../src/core/personWatcher';
import { ChairRoam, HOP_INTERVAL_MAX_MS, HOP_INTERVAL_MS } from '../src/core/chairRoam';
import { computeScreenVisibility } from '../src/core/screenVisibility';
import { seededRandom } from '../src/core/prng';
import type { Box, SeatRuntimeState, TickResult, Track } from '../src/models/types';

let failures = 0;
let passes = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

function section(title: string) {
  console.log();
  console.log('─'.repeat(78));
  console.log(title);
  console.log('─'.repeat(78));
}

const box = (px: number, py: number, w: number, h: number): Box => ({
  px, py, width: w, height: h,
});

function track(id: string, b: Box, confirmed = true): Track {
  return {
    id,
    cls: 'chair',
    box: b,
    rawBox: b,
    score: 0.9,
    centroid: { x: b.px + b.width / 2, y: b.py + b.height / 2 },
    hitStreak: 5,
    missStreak: 0,
    confirmed,
    firstTick: 1,
    lastTick: 5,
  };
}

function seatState(seatId: string, occupied: boolean): SeatRuntimeState {
  return {
    seatId,
    visibilityScore: 50,
    baseScore: 50,
    obstruction: 0,
    blockers: [],
    offAxisDeg: 0,
    distancePx: 100,
    occupied,
  };
}

/** TickResult from [seatId, occupied, confirmed?] triples. */
function tickResult(specs: [string, boolean, boolean?][]): TickResult {
  return {
    tick: 1,
    capturedAt: 0,
    chairs: specs.map(([id, , confirmed], i) =>
      track(id, box(100 + i * 120, 300, 80, 80), confirmed ?? true),
    ),
    people: [],
    occupants: [],
    seatStates: specs.map(([id, occ]) => seatState(id, occ)),
    suggestions: [],
    teacherPoint: { x: 640, y: 80 },
    stats: {} as never,
  };
}

console.log('═'.repeat(78));
console.log('HIDE N SEAT — SCREEN 2 ROUND VERIFICATION');
console.log('═'.repeat(78));

// =========================================================================
section('1. CHAIR POOLS');

{
  const result = tickResult([['A', false], ['B', true], ['C', false], ['D', true]]);

  check('tracked list includes occupied and vacant',
    trackedChairs(result).length === 4, `${trackedChairs(result).length}`);
  check('vacant list excludes occupied chairs',
    vacantChairs(result).map((c) => c.seatId).join() === 'A,C',
    vacantChairs(result).map((c) => c.seatId).join());

  // Unconfirmed tracks are still being acquired and may be junk detections.
  const withUnconfirmed = tickResult([['A', false], ['GHOST', false, false]]);
  check('unconfirmed tracks are excluded',
    trackedChairs(withUnconfirmed).map((c) => c.seatId).join() === 'A',
    trackedChairs(withUnconfirmed).map((c) => c.seatId).join());

  // A confirmed chair with no seat state happens before the teacher point is
  // set. It must count as vacant rather than being dropped.
  const unscored: TickResult = { ...result, seatStates: [] };
  check('chairs with no seat state default to vacant',
    vacantChairs(unscored).length === 4, `${vacantChairs(unscored).length}`);

  check('null tick yields empty pools',
    trackedChairs(null).length === 0 && vacantChairs(null).length === 0);
}

// =========================================================================
section('2. UNIFORM RANDOM SELECTION');

{
  const result = tickResult([['A', false], ['B', true], ['C', false], ['D', false]]);
  const rng = seededRandom('pick-trial');

  const counts = new Map<string, number>();
  const N = 60000;
  for (let i = 0; i < N; i++) {
    const p = pickRandomChair(result, rng)!;
    counts.set(p.seatId, (counts.get(p.seatId) ?? 0) + 1);
  }

  check('only vacant chairs are ever picked',
    !counts.has('B') && counts.size === 3,
    [...counts.keys()].sort().join());

  // Uniform means uniform — no visibility weighting, no luck factor.
  const expected = 1 / 3;
  let worst = 0;
  for (const id of ['A', 'C', 'D']) {
    worst = Math.max(worst, Math.abs((counts.get(id) ?? 0) / N - expected));
  }
  check('distribution is uniform across vacant chairs', worst < 0.01,
    `max deviation ${(worst * 100).toFixed(2)} pts over ${N} draws`);

  check('pick reports the pool size it drew from',
    pickRandomChair(result, rng)!.poolSize === 3);
  check('pick reports it came from the vacant pool',
    pickRandomChair(result, rng)!.fromVacant === true);
}

{
  // Fallback: everything occupied. Must still return a pick, not an error.
  const allTaken = tickResult([['A', true], ['B', true], ['C', true]]);
  const rng = seededRandom('fallback');

  const seen = new Set<string>();
  for (let i = 0; i < 5000; i++) seen.add(pickRandomChair(allTaken, rng)!.seatId);

  check('full room falls back to all tracked chairs',
    seen.size === 3, [...seen].sort().join());
  check('fallback is flagged', pickRandomChair(allTaken, rng)!.fromVacant === false);
  check('fallback pool size covers every chair',
    pickRandomChair(allTaken, rng)!.poolSize === 3);
}

{
  // Zero tracked chairs: caller treats null as "nothing to do".
  check('no chairs returns null', pickRandomChair(tickResult([]), () => 0.5) === null);
  check('null tick returns null', pickRandomChair(null, () => 0.5) === null);

  // A single vacant chair must be picked every time, with no index overflow.
  const one = tickResult([['ONLY', false], ['X', true]]);
  check('single vacant chair is always picked',
    pickRandomChair(one, () => 0.999999)!.seatId === 'ONLY');

  // rng() returning exactly 1 would index out of bounds without the clamp.
  const result = tickResult([['A', false], ['B', false]]);
  const edge = pickRandomChair(result, () => 1);
  check('rng returning 1.0 does not overflow the pool',
    edge !== null && ['A', 'B'].includes(edge.seatId), edge?.seatId ?? 'null');
  check('rng returning 0 picks the first chair',
    pickRandomChair(result, () => 0)!.seatId === 'A');
}

{
  // The box is snapshotted at pick time so the reveal animation has a stable
  // anchor even as the tracker keeps nudging boxes.
  const result = tickResult([['A', false]]);
  const p = pickRandomChair(result, () => 0)!;
  check('pick snapshots the box', p.box.width === 80 && p.box.px === 100,
    `${p.box.px},${p.box.py} ${p.box.width}x${p.box.height}`);
  check('pick carries the box centre',
    p.centre.x === 140 && p.centre.y === 340, `${p.centre.x},${p.centre.y}`);
}

// =========================================================================
section('3. RISING REVEAL TRANSFORM');

{
  check('easeOutCubic starts at 0', near(easeOutCubic(0), 0));
  check('easeOutCubic ends at 1', near(easeOutCubic(1), 1));
  check('easeOutCubic clamps below 0', near(easeOutCubic(-5), 0));
  check('easeOutCubic clamps above 1', near(easeOutCubic(9), 1));
  check('easeOutCubic front-loads the motion', easeOutCubic(0.5) > 0.5,
    `half-time progress ${easeOutCubic(0.5).toFixed(3)}`);

  let monotonic = true;
  let prev = -1;
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const v = easeOutCubic(t);
    if (v < prev - 1e-12) monotonic = false;
    prev = v;
  }
  check('easeOutCubic is monotonic', monotonic);
}

{
  const source = box(100, 300, 80, 60);

  const start = riseTransform(source, 0);
  check('reveal starts at the original position',
    near(start.box.px, source.px) && near(start.box.py, source.py),
    `${start.box.px},${start.box.py}`);
  check('reveal starts at the original size',
    near(start.box.width, source.width) && near(start.box.height, source.height));

  const end = riseTransform(source, REVEAL_MS);
  check('reveal reaches full progress', near(end.eased, 1));
  check('chair rises by RISE_FACTOR x its own height',
    near(end.box.py + end.box.height / 2, source.py + source.height / 2 - RISE_FACTOR * source.height),
    `centre moved ${(source.py + source.height / 2 - (end.box.py + end.box.height / 2)).toFixed(1)}px up`);
  check('chair scales up by RISE_SCALE',
    near(end.box.width, source.width * (1 + RISE_SCALE)),
    `${source.width} -> ${end.box.width.toFixed(1)}`);

  // Scaling about the centre, so it grows in place rather than drifting sideways.
  check('horizontal centre is preserved throughout',
    [0, 0.3, 0.7, 1].every((f) =>
      near(
        riseTransform(source, REVEAL_MS * f).box.px +
          riseTransform(source, REVEAL_MS * f).box.width / 2,
        source.px + source.width / 2,
      ),
    ));

  check('reveal holds at full rise past its duration',
    near(riseTransform(source, REVEAL_MS * 4).box.py, end.box.py),
    'no drift after settling');

  // Never travels downward — a chair that dips before lifting looks broken.
  let sank = false;
  let prevY = source.py + source.height / 2;
  for (let t = 0; t <= REVEAL_MS; t += 16) {
    const cy = riseTransform(source, t).box.py + riseTransform(source, t).box.height / 2;
    if (cy > prevY + 1e-9) sank = true;
    prevY = cy;
  }
  check('chair only ever moves upward', !sank);

  // Rise is proportional to box size, so near and far chairs lift in proportion.
  const small = riseTransform(box(0, 300, 40, 30), REVEAL_MS);
  const large = riseTransform(box(0, 300, 160, 120), REVEAL_MS);
  const smallLift = 300 + 15 - (small.box.py + small.box.height / 2);
  const largeLift = 300 + 60 - (large.box.py + large.box.height / 2);
  check('lift scales with chair size', largeLift > smallLift * 3.5,
    `small ${smallLift.toFixed(1)}px, large ${largeLift.toFixed(1)}px`);
}

// =========================================================================
section('4. ROAMING INDICATOR');

/** Chair list in the shape ChairRoam consumes, derived from a real TickResult. */
const chairsOf = (specs: [string, boolean, boolean?][]) => trackedChairs(tickResult(specs));

{
  const chairs = chairsOf([['A', false], ['B', true], ['C', false]]);
  const roam = new ChairRoam(0, seededRandom('roam-basic'), 200);

  check('no position before the first update', roam.position(chairs) === null);

  roam.update(0, chairs);
  check('first hop fires immediately at t=0', roam.hopCount === 1,
    `${roam.hopCount} hops, on ${roam.currentSeatId}`);
  check('indicator sits on a real tracked chair',
    chairs.some((c) => c.seatId === roam.currentSeatId), roam.currentSeatId ?? 'null');

  // Position must come from the chair list, not a cached coordinate.
  const seat = chairs.find((c) => c.seatId === roam.currentSeatId)!;
  const pos = roam.position(chairs)!;
  check('position matches the chair centre exactly',
    pos.x === seat.centre.x && pos.y === seat.centre.y, `${pos.x},${pos.y}`);

  // Sub-interval frames must not hop.
  roam.update(100, chairs);
  check('no hop before the interval elapses', roam.hopCount === 1, `${roam.hopCount}`);
  roam.update(200, chairs);
  check('hops once the interval elapses', roam.hopCount === 2, `${roam.hopCount}`);
}

{
  // The indicator rides its chair as the tracker nudges the box between hops.
  const before = chairsOf([['A', false]]);
  const roam = new ChairRoam(0, seededRandom('roam-follow'), 200);
  roam.update(0, before);

  const moved = before.map((c) => ({
    ...c,
    centre: { x: c.centre.x + 40, y: c.centre.y - 25 },
  }));
  const pos = roam.position(moved)!;
  check('position follows the live box between hops',
    pos.x === before[0].centre.x + 40 && pos.y === before[0].centre.y - 25,
    `${pos.x},${pos.y}`);
}

{
  const chairs = chairsOf([['A', false], ['B', false], ['C', false], ['D', false]]);
  const roam = new ChairRoam(0, seededRandom('roam-repeat'), 200);

  let repeats = 0;
  let prev: string | null = null;
  for (let t = 0; t <= 200 * 300; t += 200) {
    roam.update(t, chairs);
    if (roam.currentSeatId === prev) repeats++;
    prev = roam.currentSeatId;
  }
  check('never hops onto the same chair twice in a row', repeats === 0,
    `${repeats} repeats over 300 hops`);
}

{
  // Distribution over hops should be flat — no chair is favoured.
  const chairs = chairsOf([['A', false], ['B', false], ['C', false], ['D', false]]);
  const roam = new ChairRoam(0, seededRandom('roam-dist'), 200);
  const counts = new Map<string, number>();
  const N = 40000;
  for (let i = 0; i < N; i++) {
    roam.update(i * 200, chairs);
    counts.set(roam.currentSeatId!, (counts.get(roam.currentSeatId!) ?? 0) + 1);
  }
  check('every chair gets visited', counts.size === 4, [...counts.keys()].sort().join());
  let worst = 0;
  for (const c of chairs) worst = Math.max(worst, Math.abs((counts.get(c.seatId) ?? 0) / N - 0.25));
  check('hop distribution is roughly flat', worst < 0.02,
    `max deviation ${(worst * 100).toFixed(2)} pts`);
}

{
  // THE MID-ROAM LIST CHANGE REQUIREMENT: the list is not frozen, so a chair
  // that appears after the round starts must become a valid hop target.
  const initial = chairsOf([['A', false], ['B', false]]);
  const grown = chairsOf([['A', false], ['B', false], ['LATE', false]]);
  const roam = new ChairRoam(0, seededRandom('roam-grow'), 200);

  for (let i = 0; i < 6; i++) roam.update(i * 200, initial);
  const seenEarly = roam.currentSeatId;

  let visitedLate = false;
  for (let i = 6; i < 200; i++) {
    roam.update(i * 200, grown);
    if (roam.currentSeatId === 'LATE') visitedLate = true;
  }
  check('a chair detected mid-roam becomes a hop target', visitedLate,
    `was on ${seenEarly} before it appeared`);
}

{
  // A chair disappearing must force an immediate re-target rather than leaving
  // the indicator pointing at something no longer detected.
  const full = chairsOf([['A', false], ['B', false], ['GONE', false]]);
  const roam = new ChairRoam(0, seededRandom('roam-shrink'), 200);

  // Advance until the indicator happens to be sitting on GONE.
  let t = 0;
  while (roam.currentSeatId !== 'GONE' && t < 200 * 500) {
    t += 200;
    roam.update(t, full);
  }
  check('precondition: indicator landed on the doomed chair',
    roam.currentSeatId === 'GONE', roam.currentSeatId ?? 'null');

  const shrunk = chairsOf([['A', false], ['B', false]]);
  // Only 10ms later — well inside the hop interval, so this must be the
  // vanish-triggered re-target rather than a scheduled hop.
  roam.update(t + 10, shrunk);
  check('vanished chair triggers an immediate re-target',
    roam.currentSeatId !== 'GONE' && shrunk.some((c) => c.seatId === roam.currentSeatId),
    `now on ${roam.currentSeatId}`);
}

{
  // Detection dropping to nothing must not crash or leave a phantom position.
  const chairs = chairsOf([['A', false]]);
  const roam = new ChairRoam(0, seededRandom('roam-empty'), 200);
  roam.update(0, chairs);
  roam.update(200, []);
  check('empty chair list yields no position', roam.position([]) === null);
  check('empty chair list does not increment hops', roam.hopCount === 1,
    `${roam.hopCount}`);

  // Recovering detection resumes roaming.
  roam.update(400, chairs);
  check('roaming resumes when detection recovers', roam.hopCount === 2,
    `${roam.hopCount}`);
}

{
  // Backgrounded tab: rAF stops, so update() can be handed a huge time jump.
  // Missed hops must be dropped, not replayed in one frame.
  const chairs = chairsOf([['A', false], ['B', false], ['C', false]]);
  const roam = new ChairRoam(0, seededRandom('roam-stall'), 200);
  roam.update(0, chairs);
  const before = roam.hopCount;

  roam.update(60_000, chairs); // 60s stall = ~300 missed hops
  check('a long stall produces exactly one hop, not a replay burst',
    roam.hopCount - before === 1,
    `${roam.hopCount - before} hops processed for a 60s gap`);

  // And the hop clock must resynchronise rather than staying 60s behind.
  const afterStall = roam.hopCount;
  roam.update(60_100, chairs);
  check('hop clock resynchronises after a stall',
    roam.hopCount - afterStall <= 1, `${roam.hopCount - afterStall} extra hops`);
}

{
  // THE LANDING GUARANTEE: the final position is taken from the pick, so the
  // indicator cannot stop anywhere other than the selected chair.
  const result = tickResult([['A', false], ['B', true], ['C', false], ['D', false]]);
  const chairs = trackedChairs(result);

  let mismatches = 0;
  const rng = seededRandom('land-fuzz');

  for (let trial = 0; trial < 500; trial++) {
    const roam = new ChairRoam(0, seededRandom(`roam-${trial}`), 200);
    for (let i = 0; i < 45; i++) roam.update(i * 200, chairs);

    const pick = pickRandomChair(result, rng)!;
    roam.land(pick);

    const landed = roam.position(chairs)!;
    if (roam.currentSeatId !== pick.seatId) mismatches++;
    if (landed.x !== pick.centre.x || landed.y !== pick.centre.y) mismatches++;
  }
  check('500 rounds: indicator lands exactly on the selected chair',
    mismatches === 0, `${mismatches} mismatches`);

  const roam = new ChairRoam(0, seededRandom('land-freeze'), 200);
  roam.update(0, chairs);
  const pick = pickRandomChair(result, () => 0)!;
  roam.land(pick);
  const hopsAtLanding = roam.hopCount;
  roam.update(10_000, chairs);
  check('roaming stops once landed', roam.hopCount === hopsAtLanding && roam.isLanded,
    `${roam.hopCount} vs ${hopsAtLanding}`);

  // Landing position must survive the chair's box drifting afterwards, since the
  // reveal animates from the snapshot.
  const drifted = chairs.map((c) => ({ ...c, centre: { x: 9999, y: 9999 } }));
  const still = roam.position(drifted)!;
  check('landed position is pinned, not re-resolved from live boxes',
    still.x === pick.centre.x && still.y === pick.centre.y, `${still.x},${still.y}`);
}

{
  // Single chair: the repeat-avoidance must not deadlock.
  const one = chairsOf([['ONLY', false]]);
  const roam = new ChairRoam(0, seededRandom('roam-one'), 200);
  for (let i = 0; i < 20; i++) roam.update(i * 200, one);
  check('single-chair room keeps the indicator on that chair',
    roam.currentSeatId === 'ONLY' && roam.hopCount === 20,
    `${roam.currentSeatId}, ${roam.hopCount} hops`);
}

{
  // Hop cadence sits in the specced 150-300ms band, worst case included.
  check('nominal hop interval is in the 150-300ms band',
    HOP_INTERVAL_MS >= 150 && HOP_INTERVAL_MS <= 300, `${HOP_INTERVAL_MS}ms`);
  check('worst-case hop interval stays in band after frame quantisation',
    HOP_INTERVAL_MAX_MS <= 300, `${HOP_INTERVAL_MAX_MS}ms at 60fps`);

  // Over a 10s round that is a lot of hops — enough to read as scanning.
  const hopsPerRound = Math.floor(10_000 / HOP_INTERVAL_MS);
  check('a 10s round produces plenty of hops', hopsPerRound >= 30,
    `${hopsPerRound} hops per round`);
}

{
  check('reveal text is the current phrase', REVEAL_TEXT === 'vann iri', REVEAL_TEXT);
}

// =========================================================================
section('5. REVEAL POLISH — PULSE AND CAPTION');

{
  // Breathing oscillator must stay bounded and actually oscillate.
  let min = Infinity;
  let max = -Infinity;
  for (let t = 0; t < 3000; t += 7) {
    const u = pulseUnit(t);
    min = Math.min(min, u);
    max = Math.max(max, u);
  }
  check('pulse stays within 0..1', min >= -1e-9 && max <= 1 + 1e-9,
    `${min.toFixed(4)} .. ${max.toFixed(4)}`);
  check('pulse spans nearly the full range', max - min > 0.98,
    `range ${(max - min).toFixed(4)}`);
  check('pulse is periodic', near(pulseUnit(0), pulseUnit(PULSE_PERIOD_MS), 1e-9));

  check('pulse scale is centred above 1', pulseScale(0) >= 1 && pulseScale(0) <= 1 + PULSE_SCALE_AMOUNT,
    `${pulseScale(0).toFixed(4)}`);
  let maxScale = 0;
  for (let t = 0; t < 3000; t += 7) maxScale = Math.max(maxScale, pulseScale(t));
  check('pulse scale never exceeds the configured amount',
    maxScale <= 1 + PULSE_SCALE_AMOUNT + 1e-9, `peak ${maxScale.toFixed(4)}`);
}

{
  // Shockwave is a sawtooth: rises to 1, restarts at 0, never leaves 0..1.
  let bad = 0;
  for (let t = 0; t < 5000; t += 3) {
    const p = shockwavePhase(t);
    if (p < 0 || p >= 1.0000001) bad++;
  }
  check('shockwave phase stays in 0..1', bad === 0, `${bad} out-of-range samples`);
  check('shockwave restarts each period',
    shockwavePhase(0) < shockwavePhase(SHOCKWAVE_PERIOD_MS * 0.9) &&
      near(shockwavePhase(SHOCKWAVE_PERIOD_MS), 0, 1e-9),
    `at period boundary ${shockwavePhase(SHOCKWAVE_PERIOD_MS).toFixed(6)}`);
}

{
  // easeOutBack must overshoot — that is the entire point of the pop.
  check('easeOutBack starts at 0', near(easeOutBack(0), 0));
  check('easeOutBack ends at exactly 1', near(easeOutBack(1), 1, 1e-9),
    `${easeOutBack(1)}`);

  let peak = 0;
  let peakAt = 0;
  for (let t = 0; t <= 1; t += 0.005) {
    const v = easeOutBack(t);
    if (v > peak) { peak = v; peakAt = t; }
  }
  check('easeOutBack overshoots past 1', peak > 1.05,
    `peak ${peak.toFixed(4)} at t=${peakAt.toFixed(2)}`);
  check('overshoot settles back to 1 by the end', easeOutBack(1) < peak,
    `${easeOutBack(1).toFixed(4)} < ${peak.toFixed(4)}`);
  check('easeOutBack clamps outside 0..1',
    near(easeOutBack(-3), 0) && near(easeOutBack(4), 1, 1e-9));
}

{
  // Caption stagger: nothing drawn before its delay.
  check('caption hidden before the stagger delay',
    !captionTransform(0).visible && !captionTransform(CAPTION_DELAY_MS - 1).visible);
  check('caption appears at the stagger delay',
    captionTransform(CAPTION_DELAY_MS).visible);

  const atStart = captionTransform(CAPTION_DELAY_MS);
  check('caption starts at zero scale', near(atStart.scale, 0),
    `${atStart.scale.toFixed(6)}`);
  check('caption fades in rather than blinking', atStart.alpha < 0.05,
    `alpha ${atStart.alpha.toFixed(4)}`);

  const settled = captionTransform(CAPTION_DELAY_MS + CAPTION_MS);
  check('caption settles at scale 1', near(settled.scale, 1, 1e-9),
    `${settled.scale.toFixed(6)}`);
  check('caption wiggle damps to exactly zero', near(settled.rotation, 0, 1e-9),
    `${settled.rotation.toFixed(8)} rad`);
  check('caption ends fully opaque', near(settled.alpha, 1));

  // It must SETTLE, not loop — well past the duration it stays put.
  const later = captionTransform(CAPTION_DELAY_MS + CAPTION_MS * 8);
  check('caption stays settled, no looping',
    near(later.scale, 1, 1e-9) && near(later.rotation, 0, 1e-9),
    `scale ${later.scale.toFixed(6)}, rot ${later.rotation.toFixed(8)}`);

  // Whole thing finishes inside 1s, as specced.
  check('caption animation completes under 1s',
    CAPTION_DELAY_MS + CAPTION_MS < 1000, `${CAPTION_DELAY_MS + CAPTION_MS}ms`);

  let maxRot = 0;
  for (let t = CAPTION_DELAY_MS; t <= CAPTION_DELAY_MS + CAPTION_MS; t += 4) {
    maxRot = Math.max(maxRot, Math.abs(captionTransform(t).rotation));
  }
  check('caption wiggle stays subtle', maxRot > 0.01 && maxRot <= CAPTION_WIGGLE_RAD,
    `peak ${(maxRot * (180 / Math.PI)).toFixed(2)}°`);
}

// =========================================================================
section('6. AUTO-TRIGGER ON NEW PERSON');

/** TickResult with person tracks, for the watcher. */
function peopleTick(
  tick: number,
  people: [string, boolean][],
): TickResult {
  return {
    tick,
    capturedAt: 0,
    chairs: [],
    people: people.map(([id, confirmed], i) => ({
      id,
      cls: 'person' as const,
      box: box(50 + i * 90, 200, 60, 170),
      rawBox: box(50 + i * 90, 200, 60, 170),
      score: 0.9,
      centroid: { x: 80 + i * 90, y: 285 },
      hitStreak: confirmed ? 5 : 1,
      missStreak: 0,
      confirmed,
      firstTick: tick,
      lastTick: tick,
    })),
    occupants: [],
    seatStates: [],
    suggestions: [],
    teacherPoint: { x: 640, y: 80 },
    stats: {} as never,
  };
}

{
  const w = new NewPersonWatcher();

  // People already in frame at scan start must NOT count as entering.
  let firedDuringWarmup = 0;
  for (let t = 1; t <= WARMUP_TICKS; t++) {
    firedDuringWarmup += w.observe(peopleTick(t, [['OCC-001', true], ['OCC-002', true]])).length;
  }
  check('people already present during warmup do not fire',
    firedDuringWarmup === 0, `${firedDuringWarmup} spurious triggers`);
  check('watcher reports it is still building a baseline',
    !w.isWarm || w.ticksSeen === WARMUP_TICKS, `warm=${w.isWarm}`);

  // Same people continuing must still not fire once warm.
  const steady = w.observe(peopleTick(WARMUP_TICKS + 1, [['OCC-001', true], ['OCC-002', true]]));
  check('already-known people never re-fire', steady.length === 0, `${steady.length}`);
  check('watcher is warm after the baseline period', w.isWarm);

  // A genuinely new id fires exactly once.
  const arrival = w.observe(
    peopleTick(WARMUP_TICKS + 2, [['OCC-001', true], ['OCC-002', true], ['OCC-009', true]]),
  );
  check('a new person id fires', arrival.length === 1 && arrival[0] === 'OCC-009',
    arrival.join());

  const again = w.observe(
    peopleTick(WARMUP_TICKS + 3, [['OCC-001', true], ['OCC-002', true], ['OCC-009', true]]),
  );
  check('the same arrival does not fire twice', again.length === 0, `${again.length}`);
}

{
  const w = new NewPersonWatcher();
  for (let t = 1; t <= WARMUP_TICKS + 1; t++) w.observe(peopleTick(t, [['OCC-001', true]]));

  // Unconfirmed tracks are single-frame candidates and must be ignored.
  const unconfirmed = w.observe(peopleTick(WARMUP_TICKS + 2, [['OCC-001', true], ['GHOST', false]]));
  check('unconfirmed person tracks do not fire', unconfirmed.length === 0, unconfirmed.join());

  // Once it confirms, it counts.
  const confirmed = w.observe(peopleTick(WARMUP_TICKS + 3, [['OCC-001', true], ['GHOST', true]]));
  check('a track that later confirms then fires',
    confirmed.length === 1 && confirmed[0] === 'GHOST', confirmed.join());
}

{
  // Idempotence per tick. The caller is a React effect that can re-run for
  // reasons unrelated to a new tick arriving.
  const w = new NewPersonWatcher();
  for (let t = 1; t <= WARMUP_TICKS + 1; t++) w.observe(peopleTick(t, []));

  const tick = peopleTick(WARMUP_TICKS + 2, [['OCC-777', true]]);
  const first = w.observe(tick);
  const second = w.observe(tick);
  const third = w.observe(tick);
  check('same tick observed repeatedly fires only once',
    first.length === 1 && second.length === 0 && third.length === 0,
    `${first.length}/${second.length}/${third.length}`);
}

{
  // Engine restart: tick numbers reset and person ids are reallocated from zero.
  // The watcher must treat that as a fresh session, not as known people.
  const w = new NewPersonWatcher();
  for (let t = 1; t <= WARMUP_TICKS + 3; t++) {
    w.observe(peopleTick(t, [['OCC-001', true], ['OCC-002', true]]));
  }
  const knownBefore = w.knownCount;

  // Restart: tick goes backwards.
  const afterRestart = w.observe(peopleTick(1, [['OCC-001', true]]));
  check('a tick number going backwards resets the watcher',
    afterRestart.length === 0 && w.ticksSeen === 1,
    `knew ${knownBefore}, now ticksSeen=${w.ticksSeen}`);

  // And the reused id does not fire during the new warmup.
  let fired = 0;
  for (let t = 2; t <= WARMUP_TICKS; t++) {
    fired += w.observe(peopleTick(t, [['OCC-001', true]])).length;
  }
  check('reused ids after a restart do not fire during warmup', fired === 0, `${fired}`);
}

{
  const w = new NewPersonWatcher();
  for (let t = 1; t <= WARMUP_TICKS + 1; t++) w.observe(peopleTick(t, []));

  // Several people entering on one tick is one batch of arrivals, and the caller
  // starts a single round from it.
  const batch = w.observe(
    peopleTick(WARMUP_TICKS + 2, [['A', true], ['B', true], ['C', true]]),
  );
  check('multiple simultaneous arrivals are all reported', batch.length === 3,
    batch.join());

  w.reset();
  check('reset clears everything', w.knownCount === 0 && w.ticksSeen === 0 && !w.isWarm);
}

{
  check('cooldown is a few seconds, per spec',
    AUTO_COOLDOWN_MS >= 2000 && AUTO_COOLDOWN_MS <= 10_000, `${AUTO_COOLDOWN_MS}ms`);
  // Warmup must outlast the tracker's own confirmation delay, or a person present
  // from the start whose detection flickers would look like an arrival.
  check('warmup outlasts the tracker confirmation delay', WARMUP_TICKS > 2,
    `${WARMUP_TICKS} ticks`);
}

// =========================================================================
section('8. SIGHT RADIUS SENSITIVITY');

// =========================================================================
section('5. SIGHT RADIUS SENSITIVITY (carried over)');

{
  // DOCUMENTED SENSITIVITY, not a preference. The live default sight radius is
  // the full frame diagonal. At that radius the distance term barely bites and
  // the off-axis ANGLE dominates, so an on-axis seat at the back of the room can
  // outscore a closer seat off to one side. Same two chairs, two radii, opposite
  // winners.
  const teacher = { x: 300, y: 700 };
  const nearOff = track('NEAR-OFF', box(418, 644, 60, 60));
  const farOn = track('FAR-ON', box(730, 210, 60, 60));
  const diagonal = Math.hypot(1280, 720);

  const at = (radiusPx: number) => {
    const st = computeScreenVisibility({
      teacherPoint: teacher,
      facingDeg: -45,
      chairs: [nearOff, farOn],
      people: [],
      occupantsByChair: new Map(),
      frameWidth: 1280,
      frameHeight: 720,
      radiusPx,
    });
    return {
      near: st.find((s) => s.seatId === 'NEAR-OFF')!.visibilityScore,
      far: st.find((s) => s.seatId === 'FAR-ON')!.visibilityScore,
    };
  };

  const tight = at(800);
  const wide = at(diagonal);

  check('tight radius: distance dominates, near seat scores higher',
    tight.near > tight.far,
    `near ${tight.near.toFixed(1)} vs far ${tight.far.toFixed(1)} @ r=800`);
  check('full-diagonal radius: angle dominates, FAR seat scores higher (inverts)',
    wide.far > wide.near,
    `near ${wide.near.toFixed(1)} vs far ${wide.far.toFixed(1)} @ r=${diagonal.toFixed(0)}`);
}

// =========================================================================
section('9. SEAT CONFIRM / REDO WRAPPER');

{
  // Walk a whole turn the way a user would, threading the count through, because
  // the off-by-one is the feature: two redos, and the THIRD rejection force-locks.
  let used = 0;
  check('user starts on selection 1', selectionNumber(used) === 1, `#${selectionNumber(used)}`);

  const first = nextRedoAction(used);
  check('1st rejection re-runs the round', first.kind === 'redo', `-> ${first.kind}`);
  if (first.kind === 'redo') used = first.count;
  check('that puts the user on selection 2', selectionNumber(used) === 2, `#${selectionNumber(used)}`);

  const second = nextRedoAction(used);
  check('2nd rejection re-runs the round', second.kind === 'redo', `-> ${second.kind}`);
  if (second.kind === 'redo') used = second.count;
  check('that puts the user on selection 3', selectionNumber(used) === 3, `#${selectionNumber(used)}`);

  check('exactly REDO_LIMIT redos were granted',
    used === REDO_LIMIT, `used ${used}, limit ${REDO_LIMIT}`);

  const third = nextRedoAction(used);
  check('3rd rejection FORCE-LOCKS instead of running a 4th round',
    third.kind === 'forceLock', `-> ${third.kind}`);

  // The control has to survive to the spent state, or there is nothing to reject
  // with and the force-lock beat can never be reached.
  check('prompt still offered on selection 3, so the 3rd rejection is possible',
    canOfferRedo(REDO_LIMIT, false), `used ${REDO_LIMIT}, not settled`);

  // Part B: the prompt must appear on EVERY completed selection, no exceptions.
  // Walked over every reachable count rather than spot-checked, so a future
  // "only after the first scan" regression fails here.
  const promptOn: number[] = [];
  for (let used = 0; used < SELECTIONS_PER_TURN; used++) {
    if (canOfferRedo(used, false)) promptOn.push(selectionNumber(used));
  }
  check('prompt appears on every selection of the turn, 1st through last',
    promptOn.length === SELECTIONS_PER_TURN,
    `shown on selections ${promptOn.join(', ')} of ${SELECTIONS_PER_TURN}`);
  check('the final selection is included, not skipped straight to force-lock',
    promptOn.includes(SELECTIONS_PER_TURN),
    `selection ${SELECTIONS_PER_TURN} prompts, then No -> force-lock`);
  check('prompt visibility does not depend on the redo count',
    new Set([0, 1, 2].map((u) => canOfferRedo(u, false))).size === 1,
    'identical on all three selections');
  check('prompt withdrawn once the seat is settled — hard stop, no buttons',
    !canOfferRedo(REDO_LIMIT, true), 'settled -> no confirm/reject');
  check('confirming early also withdraws the prompt',
    !canOfferRedo(0, true) && !canOfferRedo(1, true), 'locked at any count');

  check('redo labels count down 2, 1, 0',
    redosLeft(0) === 2 && redosLeft(1) === 1 && redosLeft(2) === 0,
    `${redosLeft(0)}, ${redosLeft(1)}, ${redosLeft(2)}`);
  check('remaining never goes negative', redosLeft(99) === 0, `${redosLeft(99)}`);

  // The reset is what makes the allowance per-person rather than per-session.
  check('a new person restores the full allowance',
    nextRedoAction(0).kind === 'redo' && redosLeft(0) === REDO_LIMIT,
    `reset -> ${redosLeft(0)} left`);

  // Consolidation: exactly one ending caption, and it is not either retired one.
  check('forced-lock caption is MADUTHILLE BROO',
    FORCED_LOCK_TEXT === 'MADUTHILLE BROO', FORCED_LOCK_TEXT);
  check('confirm prompt is the Malayalam question',
    CONFIRM_PROMPT === '\u0d09\u0d31\u0d2a\u0d4d\u0d2a\u0d3f\u0d15\u0d4d\u0d15\u0d1f\u0d4d\u0d1f\u0d46?',
    CONFIRM_PROMPT);
  check('answers are labelled Yes and No',
    CONFIRM_YES === 'Yes' && CONFIRM_NO === 'No', `${CONFIRM_YES} / ${CONFIRM_NO}`);
  // Scan the shipped source rather than asserting against the constant, which
  // would only ever prove the constant is itself. This is what actually enforces
  // "only one version of this flow exists".
  const retired: Array<[string, string]> = [
    ['\u0065vdelum', 'original confirm/redo ending'],
    ['iriyadoo', 'original confirm/redo ending'],
    ['\u0d2e\u0d1f\u0d41\u0d24\u0d4d\u0d24\u0d41', 'rescan-era Malayalam fatigue line'],
    ['MADUTHU BROO', 'shortened rescan-era ending'],
    ['MADUTHILE', 'misspelled single-L variant'],
    ['nextRescanAction', 'rescan-era logic'],
    ['canOfferRescan', 'rescan-era logic'],
    ['FATIGUE_TEXT', 'rescan-era caption constant'],
  ];

  const srcFiles: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx|css)$/.test(e.name)) srcFiles.push(full);
    }
  };
  walk(join(process.cwd(), 'src'));

  check('src/ tree was actually scanned', srcFiles.length > 10, `${srcFiles.length} files`);

  for (const [needle, why] of retired) {
    const hits = srcFiles.filter((f) => readFileSync(f, 'utf8').includes(needle));
    check(`retired ${why} absent from src/`,
      hits.length === 0,
      hits.length === 0 ? 'clean' : hits.map((h) => h.split(/[\\/]/).pop()).join(', '));
  }

  check('the old rescan module is deleted',
    !existsSync(join(process.cwd(), 'src/core/rescan.ts')), 'src/core/rescan.ts');

  // "MADUTHILLE BROO is the ONLY ending caption" — proved by counting where the
  // literal is declared. One declaration, in the flow module, and every render
  // site refers to that constant rather than repeating the string.
  const literalSites = srcFiles.filter((f) => readFileSync(f, 'utf8').includes(FORCED_LOCK_TEXT));
  check('the ending caption is declared exactly once in src/',
    literalSites.length === 1,
    literalSites.map((h) => h.split(/[\\/]/).pop()).join(', ') || 'none');
  check('it is declared in the flow module, not a component',
    literalSites[0]?.endsWith('seatConfirm.ts') === true,
    literalSites[0]?.split(/[\\/]/).pop() ?? 'missing');
  // Compared as strings: TS narrows both consts to literal types and would
  // otherwise reject the comparison as provably true.
  check('seat-fixed and forced-lock end-states have different captions',
    (REVEAL_TEXT as string) !== (FORCED_LOCK_TEXT as string),
    `confirm "${REVEAL_TEXT}" vs forced "${FORCED_LOCK_TEXT}"`);
}

// =========================================================================
console.log();
console.log('═'.repeat(78));
if (failures === 0) {
  console.log(`ALL ${passes} ASSERTIONS PASSED.`);
} else {
  console.log(`${failures} FAILURE(S), ${passes} passed.`);
  process.exitCode = 1;
}
console.log('═'.repeat(78));
