/**
 * Headless verification of the screen-space pipeline.
 *
 * What this CAN prove: the geometry, tracking, occupancy and occlusion maths are
 * correct, given detections. Every case below is a hand-computed scenario with a
 * known right answer.
 *
 * What this CANNOT prove: that COCO-SSD actually finds chairs in a real
 * classroom at a real angle. That needs a camera pointed at a real room, and it
 * is the one open question in the report.
 *
 * Run: npm run verify
 */
import {
  angularInterval,
  angularOverlapFraction,
  intervalOverlapFraction,
  iou,
  segmentBoxIntersection,
} from '../src/core/geometry2d';
import { combineObstructions, coneScore } from '../src/core/scoring';
import { CentroidTracker, resetIdCounter } from '../src/core/tracker';
import { computeOccupancy } from '../src/core/occupancy';
import { computeScreenVisibility, inferFacingDeg } from '../src/core/screenVisibility';
import {
  computeSuggestions,
  SuggestionStabiliser,
  type RankedAlternatives,
} from '../src/core/suggestions';
import {
  bandStyle,
  formatScore,
  HIGHER_IS_BETTER,
  improvement,
  scoreBand,
} from '../src/core/scoreDisplay';

import type {
  Box,
  Detection,
  Occupant,
  SeatRuntimeState,
  Track,
} from '../src/models/types';

const FRAME_W = 1280;
const FRAME_H = 720;

let failures = 0;
let passes = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

function near(a: number, b: number, tol = 1e-6) {
  return Math.abs(a - b) <= tol;
}

function section(title: string) {
  console.log();
  console.log('─'.repeat(78));
  console.log(title);
  console.log('─'.repeat(78));
}

const box = (px: number, py: number, width: number, height: number): Box => ({
  px, py, width, height,
});

const det = (cls: 'chair' | 'person', b: Box, score = 0.9): Detection => ({
  box: b, score, cls,
});

function track(id: string, cls: 'chair' | 'person', b: Box): Track {
  return {
    id,
    cls,
    box: b,
    rawBox: b,
    score: 0.9,
    centroid: { x: b.px + b.width / 2, y: b.py + b.height / 2 },
    hitStreak: 5,
    missStreak: 0,
    confirmed: true,
    firstTick: 1,
    lastTick: 5,
  };
}

console.log('═'.repeat(78));
console.log('HIDE N SEAT — SCREEN-SPACE ENGINE VERIFICATION');
console.log('═'.repeat(78));

// =========================================================================
section('1. 2D GEOMETRY PRIMITIVES');

// Segment straight through the middle of a box.
{
  const hit = segmentBoxIntersection({ x: 0, y: 50 }, { x: 200, y: 50 }, box(50, 0, 100, 100));
  check(
    'segment through box returns correct entry/exit',
    hit !== null && near(hit.tEnter, 0.25) && near(hit.tExit, 0.75),
    hit ? `tEnter=${hit.tEnter} tExit=${hit.tExit}` : 'null',
  );
}
{
  const miss = segmentBoxIntersection({ x: 0, y: 500 }, { x: 200, y: 500 }, box(50, 0, 100, 100));
  check('segment missing box returns null', miss === null);
}
{
  // Perfectly vertical segment — the degenerate case the slab method has to
  // special-case, since dx = 0 would divide by zero.
  const hit = segmentBoxIntersection({ x: 100, y: 0 }, { x: 100, y: 200 }, box(50, 50, 100, 100));
  check(
    'vertical segment handled without divide-by-zero',
    hit !== null && near(hit.tEnter, 0.25) && near(hit.tExit, 0.75),
    hit ? `tEnter=${hit.tEnter} tExit=${hit.tExit}` : 'null',
  );
}
{
  const hit = segmentBoxIntersection({ x: 100, y: 100 }, { x: 300, y: 100 }, box(50, 50, 100, 100));
  check(
    'segment starting inside box gives tEnter=0',
    hit !== null && near(hit.tEnter, 0) && near(hit.tExit, 0.25),
    hit ? `tEnter=${hit.tEnter} tExit=${hit.tExit}` : 'null',
  );
}
{
  // Segment ends before reaching the box: must be rejected by the t range.
  const hit = segmentBoxIntersection({ x: 0, y: 50 }, { x: 40, y: 50 }, box(50, 0, 100, 100));
  check('segment stopping short of box returns null', hit === null);
}

// IoU.
{
  const a = box(0, 0, 100, 100);
  check('IoU of identical boxes is 1', near(iou(a, a), 1));
  check('IoU of disjoint boxes is 0', near(iou(a, box(200, 200, 50, 50)), 0));
  // Half-overlap: inter = 50x100 = 5000, union = 10000+10000-5000 = 15000.
  check('IoU of half-overlapping boxes is 1/3', near(iou(a, box(50, 0, 100, 100)), 1 / 3, 1e-9),
    iou(a, box(50, 0, 100, 100)).toFixed(6));
}

// Interval overlap.
check('interval overlap fraction, full containment', near(intervalOverlapFraction(0, 10, -5, 15), 1));
check('interval overlap fraction, half', near(intervalOverlapFraction(0, 10, 5, 20), 0.5));
check('interval overlap fraction, disjoint', near(intervalOverlapFraction(0, 10, 20, 30), 0));

// Angular intervals.
{
  const eye = { x: 0, y: 0 };
  const b = box(100, -20, 40, 40);
  const self = angularInterval(eye, b);
  check('angular self-overlap is 1', near(angularOverlapFraction(self, self), 1, 1e-9));

  const far = angularInterval(eye, box(100, 400, 40, 40));
  check('angular overlap of well-separated boxes is 0', near(angularOverlapFraction(self, far), 0));
}
{
  // A box twice as tall, at the same bearing, must fully cover the target's
  // angular extent — this is what makes a nearby blocker block more.
  const eye = { x: 0, y: 0 };
  const target = angularInterval(eye, box(200, -20, 40, 40));
  const bigger = angularInterval(eye, box(100, -40, 40, 80));
  check(
    'larger nearer box fully covers target angular extent',
    near(angularOverlapFraction(target, bigger), 1, 1e-9),
    angularOverlapFraction(target, bigger).toFixed(4),
  );
}

// =========================================================================
section('2. SCORING CORE');

{
  const dead = coneScore({ offAxisDeg: 0, halfConeDeg: 60, distance: 0, radius: 1000 });
  check('dead centre at zero range scores 1', near(dead.factor, 1));

  const edge = coneScore({ offAxisDeg: 60, halfConeDeg: 60, distance: 0, radius: 1000 });
  check('cone edge scores 0 (cosine falloff)', near(edge.factor, 0, 1e-9));

  const outside = coneScore({ offAxisDeg: 61, halfConeDeg: 60, distance: 10, radius: 1000 });
  check('outside cone is flagged and zeroed', outside.outside && near(outside.factor, 0));

  const tooFar = coneScore({ offAxisDeg: 0, halfConeDeg: 60, distance: 1001, radius: 1000 });
  check('beyond radius is flagged and zeroed', tooFar.outside && near(tooFar.factor, 0));

  const a = coneScore({ offAxisDeg: 0, halfConeDeg: 60, distance: 100, radius: 1000 });
  const b = coneScore({ offAxisDeg: 0, halfConeDeg: 60, distance: 500, radius: 1000 });
  check('score decreases with distance', a.factor > b.factor,
    `${a.factor.toFixed(3)} > ${b.factor.toFixed(3)}`);

  const c = coneScore({ offAxisDeg: 10, halfConeDeg: 60, distance: 100, radius: 1000 });
  const d = coneScore({ offAxisDeg: 45, halfConeDeg: 60, distance: 100, radius: 1000 });
  check('score decreases off-axis', c.factor > d.factor,
    `${c.factor.toFixed(3)} > ${d.factor.toFixed(3)}`);
}

{
  check('combine: single blocker passes through', near(combineObstructions([0.4]), 0.4));
  // 1 - 0.5*0.5 = 0.75. Two half blockers must stack, not overwrite.
  check('combine: two 0.5 blockers stack to 0.75', near(combineObstructions([0.5, 0.5]), 0.75));
  check('combine: order independent',
    near(combineObstructions([0.3, 0.7]), combineObstructions([0.7, 0.3])));
  check('combine: never exceeds 1', combineObstructions([0.9, 0.9, 0.9]) <= 1);
  check('combine: empty is 0', near(combineObstructions([]), 0));
}

// =========================================================================
section('3. TRACKING — IDENTITY ACROSS TICKS');

{
  resetIdCounter();
  const tracker = new CentroidTracker('chair');

  // Two chairs, jittering a few pixels per tick. IDs must not reshuffle.
  const idsPerTick: string[][] = [];
  for (let t = 0; t < 6; t++) {
    const jitter = (t % 2 === 0 ? 1 : -1) * 4;
    tracker.update(
      [
        det('chair', box(200 + jitter, 300 + jitter, 80, 80)),
        det('chair', box(500 - jitter, 300 + jitter, 80, 80)),
      ],
      FRAME_W,
      FRAME_H,
    );
    idsPerTick.push(tracker.all().map((x) => x.id).sort());
  }

  const stable = idsPerTick.every(
    (ids) => ids.length === 2 && ids.join() === idsPerTick[0].join(),
  );
  check('chair IDs stay stable across 6 jittered ticks', stable,
    `${idsPerTick[0].join()} -> ${idsPerTick[5].join()}`);

  const confirmedAfter2 = tracker.confirmed().length === 2;
  check('both chairs confirmed after 2+ hits', confirmedAfter2);
}

{
  resetIdCounter();
  const tracker = new CentroidTracker('chair');
  const b = box(200, 300, 80, 80);

  tracker.update([det('chair', b)], FRAME_W, FRAME_H);
  tracker.update([det('chair', b)], FRAME_W, FRAME_H);
  const id = tracker.all()[0].id;

  // Three consecutive misses: must survive, because DROP_AFTER_MISSES is 4.
  const survived: boolean[] = [];
  for (let i = 0; i < 3; i++) {
    tracker.update([], FRAME_W, FRAME_H);
    survived.push(tracker.all().some((t) => t.id === id));
  }
  check('track survives 3 consecutive missed ticks', survived.every(Boolean),
    `presence: ${survived.map((s) => (s ? '1' : '0')).join('')}`);

  tracker.update([], FRAME_W, FRAME_H); // 4th miss
  check('track dropped on 4th consecutive miss', !tracker.all().some((t) => t.id === id));
}

{
  resetIdCounter();
  const tracker = new CentroidTracker('chair');
  // Re-acquiring after a gap must reuse the SAME id if within the gate, so a
  // brief detector failure does not reset the seat's score history.
  tracker.update([det('chair', box(200, 300, 80, 80))], FRAME_W, FRAME_H);
  tracker.update([det('chair', box(200, 300, 80, 80))], FRAME_W, FRAME_H);
  const id = tracker.all()[0].id;
  tracker.update([], FRAME_W, FRAME_H);
  tracker.update([det('chair', box(205, 302, 80, 80))], FRAME_W, FRAME_H);
  check('re-acquired track keeps its original id', tracker.all()[0].id === id,
    `${id} -> ${tracker.all()[0].id}`);
}

{
  resetIdCounter();
  const tracker = new CentroidTracker('chair');
  // Globally-greedy matching test. Two tracks at x=100 and x=150 (centroids
  // 140 and 190). Detections arrive at centroids 188 and 240.
  // A naive per-track loop would let track A claim 188 (dist 48) even though it
  // is a near-perfect match for B (dist 2), shifting both tracks wrongly.
  tracker.update(
    [det('chair', box(100, 300, 80, 80)), det('chair', box(150, 300, 80, 80))],
    FRAME_W,
    FRAME_H,
  );
  tracker.update(
    [det('chair', box(100, 300, 80, 80)), det('chair', box(150, 300, 80, 80))],
    FRAME_W,
    FRAME_H,
  );
  const before = tracker.all();
  const bId = before.find((t) => Math.abs(t.centroid.x - 190) < 1)!.id;

  tracker.update(
    [det('chair', box(148, 300, 80, 80)), det('chair', box(200, 300, 80, 80))],
    FRAME_W,
    FRAME_H,
  );
  const matched = tracker.all().find((t) => t.id === bId);
  check(
    'greedy matching gives the detection to its best-fitting track',
    matched !== undefined && Math.abs(matched.centroid.x - 190) < 6,
    matched ? `${bId} centroid x=${matched.centroid.x.toFixed(1)}` : 'track lost',
  );
}

{
  resetIdCounter();
  const tracker = new CentroidTracker('chair');
  // A jump beyond the gate must create a NEW id, not drag the old track across
  // the room.
  tracker.update([det('chair', box(100, 300, 80, 80))], FRAME_W, FRAME_H);
  tracker.update([det('chair', box(100, 300, 80, 80))], FRAME_W, FRAME_H);
  const id = tracker.all()[0].id;
  tracker.update([det('chair', box(900, 300, 80, 80))], FRAME_W, FRAME_H);
  const ids = tracker.all().map((t) => t.id);
  check(
    'detection beyond match gate creates a new track',
    ids.length === 2 && ids.includes(id),
    ids.join(),
  );
}

{
  resetIdCounter();
  const chairT = new CentroidTracker('chair');
  const personT = new CentroidTracker('person');
  const mixed = [det('chair', box(100, 300, 80, 80)), det('person', box(400, 200, 70, 180))];
  chairT.update(mixed, FRAME_W, FRAME_H);
  personT.update(mixed, FRAME_W, FRAME_H);
  check('trackers filter by class', chairT.all().length === 1 && personT.all().length === 1,
    `chair=${chairT.all().length} person=${personT.all().length}`);
  check('ids are class-prefixed', chairT.all()[0].id.startsWith('SEAT-') &&
    personT.all()[0].id.startsWith('OCC-'),
    `${chairT.all()[0].id} / ${personT.all()[0].id}`);
}

// =========================================================================
section('4. OCCUPANCY');

{
  // Strong overlap: person seated, box covers the chair. IoU = 0.615.
  const chair = track('SEAT-1', 'chair', box(100, 300, 80, 80));
  const person = track('OCC-1', 'person', box(100, 250, 80, 130));
  const r = computeOccupancy([chair], [person], 0);
  check('seated person marks chair occupied via IoU',
    r.occupants.length === 1 && r.occupants[0].matchRule === 'iou',
    `iou=${r.occupants[0]?.matchIou}`);
}
{
  // Zero IoU, but the person's bottom-centre lands on the chair. This is the
  // front-on camera case the fallback rule exists for.
  const chair = track('SEAT-1', 'chair', box(100, 300, 80, 80));
  const person = track('OCC-1', 'person', box(100, 150, 80, 140));
  const r = computeOccupancy([chair], [person], 0);
  check('bottom-centre fallback catches zero-IoU seated pair',
    r.occupants.length === 1 && r.occupants[0].matchRule === 'bottom-centre',
    `iou=${iou(chair.box, person.box).toFixed(3)}`);
}
{
  const chair = track('SEAT-1', 'chair', box(100, 300, 80, 80));
  const person = track('OCC-1', 'person', box(800, 300, 80, 180));
  const r = computeOccupancy([chair], [person], 0);
  check('distant person leaves chair empty', r.occupants.length === 0);
}
{
  // One person between two chairs must not occupy both.
  const c1 = track('SEAT-1', 'chair', box(100, 300, 80, 80));
  const c2 = track('SEAT-2', 'chair', box(150, 300, 80, 80));
  const person = track('OCC-1', 'person', box(120, 250, 80, 130));
  const r = computeOccupancy([c1, c2], [person], 0);
  check('one person cannot occupy two chairs', r.occupants.length === 1,
    `claimed ${r.occupants.map((o) => o.seatId).join()}`);
}
{
  const chair = track('SEAT-1', 'chair', box(100, 300, 80, 80));
  const person = track('OCC-1', 'person', box(100, 250, 80, 130));
  const r = computeOccupancy([chair], [person], 0);
  check('estimatedHeightCm left undefined on screen-space path',
    r.occupants[0].estimatedHeightCm === undefined);
}

// =========================================================================
section('5. OCCLUSION — SCREEN SPACE');

const TEACHER = { x: 640, y: 80 };
const noOccupants = new Map<string, Occupant>();

function score(chairs: Track[], people: Track[], occ = noOccupants) {
  return computeScreenVisibility({
    teacherPoint: TEACHER,
    facingDeg: 90, // straight down-frame, pinned for determinism
    chairs,
    people,
    occupantsByChair: occ,
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
  });
}

// Target chair, and a person in the row in front: overlapping the target
// vertically but extending lower in frame (= nearer the camera).
const targetChair = track('SEAT-T', 'chair', box(570, 370, 60, 60));
const frontPerson = track('OCC-F', 'person', box(575, 350, 55, 120));

{
  const clean = score([targetChair], [])[0];
  check('unblocked chair keeps its full base score',
    near(clean.visibilityScore, clean.baseScore) && clean.blockers.length === 0,
    `vis=${clean.visibilityScore.toFixed(1)} base=${clean.baseScore.toFixed(1)}`);
  check('unblocked chair has no occlusionSource', clean.occlusionSource === undefined);
}

{
  const blocked = score([targetChair], [frontPerson])[0];
  check('person in front applies a penalty',
    blocked.obstruction > 0.3 && blocked.visibilityScore < blocked.baseScore,
    `obstruction=${(blocked.obstruction * 100).toFixed(0)}% vis=${blocked.visibilityScore.toFixed(1)} base=${blocked.baseScore.toFixed(1)}`);
  check('dominant blocker is reported as occlusionSource',
    blocked.occlusionSource === 'OCC-F', blocked.occlusionSource ?? 'none');
  check('penalty is proportional, not a binary cut',
    blocked.visibilityScore > 0 && blocked.obstruction < 1,
    `vis=${blocked.visibilityScore.toFixed(1)}`);
}

{
  // DEPTH PROXY: a box HIGHER in frame is further away, so it sits behind the
  // target and must not block it, even though the sightline crosses it.
  const behind = track('OCC-B', 'person', box(590, 200, 60, 100));
  const hit = segmentBoxIntersection(TEACHER, targetChair.centroid, behind.box);
  const state = score([targetChair], [behind])[0];
  check('sightline does cross the behind-box (precondition)', hit !== null);
  check('box behind target is ignored via depth proxy',
    state.obstruction === 0 && state.blockers.length === 0,
    `obstruction=${state.obstruction}`);
}

{
  // Two partial blockers must stack per 1 - product(1 - oᵢ).
  const b1 = track('OCC-1', 'person', box(575, 350, 30, 120));
  const b2 = track('OCC-2', 'person', box(605, 350, 30, 120));
  const state = score([targetChair], [b1, b2])[0];
  const manual = combineObstructions(state.blockers.map((b) => b.obstruction));
  check('two blockers both register', state.blockers.length === 2,
    `${state.blockers.map((b) => `${b.trackId}:${b.obstruction.toFixed(3)}`).join(' ')}`);
  check('combined obstruction matches 1-product(1-oᵢ)',
    near(state.obstruction, manual, 1e-9),
    `${state.obstruction.toFixed(6)} vs ${manual.toFixed(6)}`);
  check('stacked obstruction exceeds either blocker alone',
    state.blockers.length === 2 &&
      state.obstruction > Math.max(...state.blockers.map((b) => b.obstruction)),
    `${(state.obstruction * 100).toFixed(1)}% > ${(Math.max(...state.blockers.map((b) => b.obstruction)) * 100).toFixed(1)}%`);
}

{
  // A chair's OWN occupant must not occlude it. Without the exclusion every
  // occupied seat would occlude itself and read as permanently safe.
  const occ = new Map<string, Occupant>([
    ['SEAT-T', { seatId: 'SEAT-T', present: true, detectedAt: 0, personTrackId: 'OCC-F' }],
  ]);
  const withExclusion = score([targetChair], [frontPerson], occ)[0];
  const without = score([targetChair], [frontPerson])[0];
  check('own occupant excluded from occlusion',
    withExclusion.obstruction === 0 && without.obstruction > 0,
    `own-occupant=${withExclusion.obstruction} stranger=${without.obstruction.toFixed(3)}`);
  check('occupied flag set from the occupant map', withExclusion.occupied === true);
}

{
  // Laterally offset blocker: sightline never crosses it, so no penalty.
  const aside = track('OCC-A', 'person', box(200, 350, 55, 120));
  const state = score([targetChair], [aside])[0];
  check('blocker off to the side does not register',
    state.obstruction === 0, `obstruction=${state.obstruction}`);
}

{
  // Outside the cone entirely: 90° facing down-frame, chair placed above the
  // teacher, so it is behind them.
  const behindTeacher = track('SEAT-B', 'chair', box(600, 10, 60, 40));
  const state = score([behindTeacher], [])[0];
  check('chair behind the teacher scores 0',
    near(state.visibilityScore, 0) && near(state.baseScore, 0),
    `offAxis=${state.offAxisDeg.toFixed(1)}°`);
  check('out-of-cone chair skips occlusion work', state.blockers.length === 0);
}

{
  // Base score must fall with distance along the same bearing.
  const nearChair = track('SEAT-N', 'chair', box(610, 200, 60, 60));
  const farChair = track('SEAT-F', 'chair', box(610, 600, 60, 60));
  const states = score([nearChair, farChair], []);
  const n = states.find((s) => s.seatId === 'SEAT-N')!;
  const f = states.find((s) => s.seatId === 'SEAT-F')!;
  check('base score falls with distance', n.baseScore > f.baseScore,
    `near=${n.baseScore.toFixed(1)} far=${f.baseScore.toFixed(1)}`);
}

{
  // And with off-axis angle, at matched distance.
  const r = 300;
  const onAxis = track('SEAT-ON', 'chair', box(640 - 30, 80 + r - 30, 60, 60));
  const rad = (50 * Math.PI) / 180;
  const offAxis = track('SEAT-OFF', 'chair',
    box(640 + Math.cos(rad) * r - 30, 80 + Math.sin(rad) * r - 30, 60, 60));
  const states = score([onAxis, offAxis], []);
  const on = states.find((s) => s.seatId === 'SEAT-ON')!;
  const off = states.find((s) => s.seatId === 'SEAT-OFF')!;
  check('base score falls off-axis at equal distance', on.baseScore > off.baseScore,
    `on=${on.baseScore.toFixed(1)}@${on.offAxisDeg.toFixed(0)}° off=${off.baseScore.toFixed(1)}@${off.offAxisDeg.toFixed(0)}°`);
  check('equal-distance precondition holds',
    Math.abs(on.distancePx - off.distancePx) < 2,
    `${on.distancePx.toFixed(1)} vs ${off.distancePx.toFixed(1)}`);
}

// =========================================================================
section('6. SCORE DISPLAY FORMATTING');

{
  check('score formatted as XX/100', formatScore(41.6) === '42/100', formatScore(41.6));
  check('score rounds, never truncates', formatScore(69.5) === '70/100', formatScore(69.5));
  check('band edges: 39 is low', scoreBand(39) === 'low');
  check('band edges: 40 is mid', scoreBand(40) === 'mid');
  check('band edges: 70 is mid (inclusive upper)', scoreBand(70) === 'mid');
  check('band edges: 71 is high', scoreBand(71) === 'high');

  // Under the default exposure semantics, a high score must read as danger.
  const hi = bandStyle(85);
  const lo = bandStyle(10);
  check(
    'colour semantics agree with HIGHER_IS_BETTER',
    HIGHER_IS_BETTER
      ? hi.label === 'CONCEALED' && lo.label === 'EXPOSED'
      : hi.label === 'EXPOSED' && lo.label === 'CONCEALED',
    `HIGHER_IS_BETTER=${HIGHER_IS_BETTER}: 85 -> ${hi.label}, 10 -> ${lo.label}`,
  );

  // improvement() must agree with the same constant, or suggestions would point
  // the opposite way to the colours.
  const imp = improvement(20, 80);
  check(
    'improvement direction agrees with HIGHER_IS_BETTER',
    HIGHER_IS_BETTER ? imp === -60 : imp === 60,
    `improvement(20, 80) = ${imp}`,
  );
}

// =========================================================================
section('7. SEAT SUGGESTIONS');

/** Minimal SeatRuntimeState for suggestion tests. */
function seatState(
  seatId: string,
  visibilityScore: number,
  occupied: boolean,
): SeatRuntimeState {
  return {
    seatId,
    visibilityScore,
    baseScore: visibilityScore,
    obstruction: 0,
    blockers: [],
    offAxisDeg: 0,
    distancePx: 100,
    occupied,
  };
}

/**
 * Build a score that is `gap` points BETTER than `from` under the active
 * semantics, so these tests hold whichever way HIGHER_IS_BETTER is set.
 */
const betterBy = (from: number, gap: number) =>
  HIGHER_IS_BETTER ? from + gap : from - gap;

{
  const states = [
    seatState('OCC-SEAT', 50, true),
    seatState('GOOD', betterBy(50, 30), false),
    seatState('MEH', betterBy(50, 5), false),
    seatState('WORSE', betterBy(50, -30), false),
  ];
  const sets = computeSuggestions(states);
  check('one suggestion set per occupied seat', sets.length === 1, `${sets.length}`);

  const ids = sets[0].ranked.map((c) => c.targetSeatId);
  check('suggests the meaningfully better seat', ids.includes('GOOD'), ids.join() || 'none');
  check('ignores gaps below the threshold', !ids.includes('MEH'), ids.join());
  check('never suggests a worse seat', !ids.includes('WORSE'), ids.join());
}

{
  // An occupied seat must never be suggested, however good it looks.
  const states = [
    seatState('OCC-A', 50, true),
    seatState('OCC-B', betterBy(50, 40), true),
    seatState('EMPTY', betterBy(50, 20), false),
  ];
  const sets = computeSuggestions(states);
  const forA = sets.find((s) => s.seatId === 'OCC-A')!;
  const ids = forA.ranked.map((c) => c.targetSeatId);
  check('never suggests displacing another occupant', !ids.includes('OCC-B'), ids.join());
  check('still suggests the empty alternative', ids.includes('EMPTY'), ids.join());
}

{
  const states = [
    seatState('OCC-SEAT', 50, true),
    seatState('E1', betterBy(50, 20), false),
    seatState('E2', betterBy(50, 40), false),
    seatState('E3', betterBy(50, 30), false),
    seatState('E4', betterBy(50, 25), false),
  ];
  const sets = computeSuggestions(states);
  const ids = sets[0].ranked.map((c) => c.targetSeatId);
  check('full ranked list keeps all qualifying seats', ids.length === 4, ids.join());
  check('ranked by gap, largest first', ids[0] === 'E2' && ids[1] === 'E3', ids.join());
  check('ranks are 1-based and sequential',
    sets[0].ranked.every((c, i) => c.rank === i + 1),
    sets[0].ranked.map((c) => c.rank).join());
  check('gap is positive and correct', Math.abs(sets[0].ranked[0].gap - 40) < 1e-9,
    `${sets[0].ranked[0].gap}`);

  // Display capping happens in the stabiliser, not the comparison pass.
  const displayed = new SuggestionStabiliser(3).update(sets)[0];
  check('displayed candidates capped at 3', displayed.candidates.length === 3,
    `${displayed.candidates.length}`);
  check('totalAlternatives reports the uncapped count', displayed.totalAlternatives === 4,
    `${displayed.totalAlternatives}`);
}

{
  const states = [seatState('OCC-SEAT', 50, true), seatState('MEH', betterBy(50, 3), false)];
  const sets = computeSuggestions(states);
  check('no candidates when nothing is meaningfully better',
    sets[0].ranked.length === 0, `${sets[0].ranked.length}`);
}

{
  // Deterministic tie-break, so identical rankings never look like a change to
  // the debouncer.
  const states = [
    seatState('OCC-SEAT', 50, true),
    seatState('ZZZ', betterBy(50, 30), false),
    seatState('AAA', betterBy(50, 30), false),
  ];
  const a = computeSuggestions(states)[0].ranked.map((c) => c.targetSeatId);
  const b = computeSuggestions([...states].reverse())[0].ranked.map((c) => c.targetSeatId);
  check('tied gaps break deterministically by seat id',
    a.join() === b.join() && a[0] === 'AAA', `${a.join()} vs ${b.join()}`);
}

// ---- debouncer ----------------------------------------------------------
/** Ranked-alternatives fixture: `order` lists target ids best-first. */
function alts(order: string[], gaps?: number[]): RankedAlternatives[] {
  return [
    {
      seatId: 'OCC-SEAT',
      ranked: order.map((id, i) => ({
        targetSeatId: id,
        targetScore: 20 + i,
        currentScore: 50,
        gap: gaps?.[i] ?? 30 - i,
        rank: i + 1,
      })),
    },
  ];
}

{
  const stab = new SuggestionStabiliser(3);

  const first = stab.update(alts(['A', 'B']));
  check('first pick is adopted immediately', first[0].displayed?.targetSeatId === 'A',
    first[0].displayed?.targetSeatId ?? 'none');

  // B overtakes A in the ranking, but A remains a valid seat. The swap must
  // wait for 3 consecutive ticks of B holding first place.
  const t1 = stab.update(alts(['B', 'A']));
  const t2 = stab.update(alts(['B', 'A']));
  const t3 = stab.update(alts(['B', 'A']));
  check('challenger does not take over on tick 1',
    t1[0].displayed?.targetSeatId === 'A', t1[0].displayed?.targetSeatId ?? 'none');
  check('challenger does not take over on tick 2',
    t2[0].displayed?.targetSeatId === 'A', t2[0].displayed?.targetSeatId ?? 'none');
  check('challenger takes over on tick 3',
    t3[0].displayed?.targetSeatId === 'B', t3[0].displayed?.targetSeatId ?? 'none');
  check('challenger streak is reported for debugging', t2[0].challengerId === 'B',
    `challenger=${t2[0].challengerId} streak=${t2[0].challengerStreak}`);
}

{
  // The flicker case this exists for: two near-tied options swapping first place
  // every tick must never change the displayed pick.
  const stab = new SuggestionStabiliser(3);
  stab.update(alts(['A', 'B']));

  const seen: string[] = [];
  for (let i = 0; i < 8; i++) {
    const r = stab.update(i % 2 === 0 ? alts(['B', 'A']) : alts(['A', 'B']));
    seen.push(r[0].displayed?.targetSeatId ?? '-');
  }
  check('alternating near-ties never flip the displayed pick',
    seen.every((s) => s === 'A'), seen.join(''));
}

{
  // A pick that slips well down the ranking but stays valid must be HELD, not
  // swapped. This is the case the first implementation got wrong.
  const stab = new SuggestionStabiliser(3);
  stab.update(alts(['A', 'B', 'C', 'D']));
  const slipped = stab.update(alts(['B', 'C', 'D', 'A']));
  check('pick that slips to 4th place is still held',
    slipped[0].displayed?.targetSeatId === 'A', slipped[0].displayed?.targetSeatId ?? 'none');
  check('held pick outside the display slice still has live numbers',
    slipped[0].displayed !== undefined && slipped[0].candidates.length === 3,
    `displayed=${slipped[0].displayed?.targetSeatId} candidates=${slipped[0].candidates.map((c) => c.targetSeatId).join()}`);
}

{
  // Invalidation must be immediate, not debounced: a suggestion pointing at a
  // seat somebody just took is worse than no suggestion.
  const stab = new SuggestionStabiliser(3);
  stab.update(alts(['A']));
  const after = stab.update(alts(['C']));
  check('target that stops qualifying is replaced the same tick',
    after[0].displayed?.targetSeatId === 'C', after[0].displayed?.targetSeatId ?? 'none');
}

{
  const stab = new SuggestionStabiliser(3);
  stab.update(alts(['A']));
  const empty = stab.update([{ seatId: 'OCC-SEAT', ranked: [] }]);
  check('no candidates clears the displayed pick', empty[0].displayed === undefined);
}

{
  // Numbers must stay live while the pick is held.
  const stab = new SuggestionStabiliser(3);
  stab.update(alts(['A']));
  const updated = stab.update([
    {
      seatId: 'OCC-SEAT',
      ranked: [{ targetSeatId: 'A', targetScore: 12, currentScore: 55, gap: 43, rank: 1 }],
    },
  ]);
  check('held pick still refreshes its scores each tick',
    updated[0].displayed?.targetScore === 12 && updated[0].displayed?.currentScore === 55,
    `target=${updated[0].displayed?.targetScore} current=${updated[0].displayed?.currentScore}`);
}

{
  // State for a seat that stops being occupied must not leak.
  const stab = new SuggestionStabiliser(3);
  stab.update(alts(['A']));
  const none = stab.update([]);
  check('vacated seats produce no suggestion sets', none.length === 0, `${none.length}`);
  const back = stab.update(alts(['B']));
  check('re-occupied seat adopts a fresh pick immediately',
    back[0].displayed?.targetSeatId === 'B', back[0].displayed?.targetSeatId ?? 'none');
}

// ---- end-to-end through the real scoring engine -------------------------
{
  // Real chairs, real scores, real suggestion pass: an occupied chair near the
  // teacher should be pointed at an empty one further out.
  const nearOccupied = track('SEAT-NEAR', 'chair', box(610, 180, 60, 60));
  const farEmpty = track('SEAT-FAR', 'chair', box(610, 640, 60, 60));
  const person = track('OCC-1', 'person', box(610, 140, 60, 130));

  const occ = computeOccupancy([nearOccupied, farEmpty], [person], 0);
  const states = computeScreenVisibility({
    teacherPoint: TEACHER,
    facingDeg: 90,
    chairs: [nearOccupied, farEmpty],
    people: [person],
    occupantsByChair: occ.byChair,
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
  });

  const nearState = states.find((s) => s.seatId === 'SEAT-NEAR')!;
  const farState = states.find((s) => s.seatId === 'SEAT-FAR')!;
  check('end-to-end: occupancy detected on the near chair', nearState.occupied,
    `near occupied=${nearState.occupied} far occupied=${farState.occupied}`);

  const sets = computeSuggestions(states);
  const pick = sets.find((s) => s.seatId === 'SEAT-NEAR')?.ranked[0];
  check(
    'end-to-end: near occupied seat is pointed at the far empty one',
    pick?.targetSeatId === 'SEAT-FAR',
    `near=${formatScore(nearState.visibilityScore)} far=${formatScore(farState.visibilityScore)} pick=${pick?.targetSeatId ?? 'none'}`,
  );
}


// =========================================================================
section('8. TEACHER FACING INFERENCE');

{
  const chairs = [
    track('SEAT-1', 'chair', box(400, 400, 60, 60)),
    track('SEAT-2', 'chair', box(800, 400, 60, 60)),
  ];
  // Teacher above the mean chair position: cone must point down-frame (+90°).
  const facing = inferFacingDeg({ x: 630, y: 100 }, chairs);
  check('facing points from teacher toward the class', Math.abs(facing - 90) < 5,
    `${facing.toFixed(1)}°`);
}
{
  const facing = inferFacingDeg({ x: 100, y: 400 }, [
    track('SEAT-1', 'chair', box(800, 370, 60, 60)),
  ]);
  check('teacher at left of frame faces right', Math.abs(facing) < 5, `${facing.toFixed(1)}°`);
}
{
  check('no chairs falls back to 90 degrees', inferFacingDeg({ x: 0, y: 0 }, []) === 90);
}
{
  // Degenerate: teacher clicked exactly on the only chair's centre.
  const facing = inferFacingDeg({ x: 430, y: 430 }, [track('SEAT-1', 'chair', box(400, 400, 60, 60))]);
  check('teacher clicked on a chair does not produce NaN facing', Number.isFinite(facing),
    `${facing}°`);
}

// =========================================================================
console.log();
console.log('═'.repeat(78));
if (failures === 0) {
  console.log(`ALL ${passes} ASSERTIONS PASSED — geometry, tracking, occupancy, occlusion sane.`);
  console.log('NOT verified here: real-world chair detection recall. Needs a camera.');
} else {
  console.log(`${failures} FAILURE(S), ${passes} passed.`);
  process.exitCode = 1;
}
console.log('═'.repeat(78));
