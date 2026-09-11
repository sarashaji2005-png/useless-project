/**
 * Verification for the chair-coverage fix.
 *
 * The bug: coco-ssd 2.2.3 passes its `minScore` argument as BOTH the IoU
 * threshold and the score threshold to non-max suppression, and runs that
 * suppression class-agnostically. Asking for a low score threshold (which
 * classroom chairs need) therefore also sets a punishing IoU threshold, and rows
 * of overlapping chairs delete each other.
 *
 * These tests reproduce that geometry with a synthetic row of chairs and show the
 * old coupled behaviour losing them and the new decoupled behaviour keeping them.
 *
 * Run: npm run verify:detection
 */
import {
  CLASS_INDEX_TO_TRACK,
  decodeCandidates,
  NMS_IOU_THRESHOLD,
  NMS_SCORE_THRESHOLD,
  suppressPerClass,
} from '../src/detect/postprocess';
import { CHAIR_MIN_SCORE, PERSON_MIN_SCORE } from '../src/detect/detector';
import { CONFIRM_HITS } from '../src/core/tracker';
import type { Detection } from '../src/models/types';

let failures = 0;
let passes = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

function section(title: string) {
  console.log();
  console.log('─'.repeat(78));
  console.log(title);
  console.log('─'.repeat(78));
}

const box = (px: number, py: number, w: number, h: number): Detection['box'] => ({
  px, py, width: w, height: h,
});

/** The suppression coco-ssd actually performs: one threshold, all classes. */
function legacyCoupledSuppress(
  candidates: readonly { box: Detection['box']; score: number; cls: string }[],
  minScore: number,
) {
  const sorted = [...candidates]
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score);
  const kept: typeof sorted = [];

  for (const c of sorted) {
    let suppressed = false;
    for (const k of kept) {
      // Class-agnostic, and iouThreshold === minScore.
      const ax2 = c.box.px + c.box.width;
      const ay2 = c.box.py + c.box.height;
      const bx2 = k.box.px + k.box.width;
      const by2 = k.box.py + k.box.height;
      const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(c.box.px, k.box.px));
      const iy = Math.max(0, Math.min(ay2, by2) - Math.max(c.box.py, k.box.py));
      const inter = ix * iy;
      const union = c.box.width * c.box.height + k.box.width * k.box.height - inter;
      const iouVal = union <= 0 ? 0 : inter / union;
      if (iouVal > minScore) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) kept.push(c);
  }
  return kept;
}

/**
 * A row of eight chairs seen obliquely: each overlaps its neighbour by about a
 * third of its width, which is entirely normal for classroom seating viewed from
 * the front of the room.
 */
function chairRow(count = 8) {
  const out: { box: Detection['box']; score: number; cls: 'chair' | 'person' }[] = [];
  const w = 90;
  const step = w * 0.62; // 38% horizontal overlap with the next chair
  for (let i = 0; i < count; i++) {
    out.push({
      box: box(100 + i * step, 300, w, 95),
      // Plausible spread for real classroom chairs.
      score: 0.34 - i * 0.02,
      cls: 'chair',
    });
  }
  return out;
}

console.log('═'.repeat(78));
console.log('HIDE N SEAT — CHAIR DETECTION COVERAGE VERIFICATION');
console.log('═'.repeat(78));

// =========================================================================
section('1. REPRODUCING THE BUG');

{
  const row = chairRow(8);
  const overlap = (() => {
    const a = row[0].box;
    const b = row[1].box;
    const ix = Math.max(0, Math.min(a.px + a.width, b.px + b.width) - Math.max(a.px, b.px));
    const inter = ix * a.height;
    const union = a.width * a.height + b.width * b.height - inter;
    return inter / union;
  })();

  check('adjacent chairs in a row overlap well above 0.12 IoU', overlap > 0.12,
    `neighbouring IoU = ${overlap.toFixed(3)}`);

  // This is what the library does with MODEL_MIN_SCORE = 0.12. At this modest
  // 38% spacing it takes out every other chair — half the row.
  const legacy = legacyCoupledSuppress(row, 0.12);
  check('coupled thresholds at 0.12 lose most of the row',
    legacy.length < row.length * 0.6,
    `${row.length} real chairs -> ${legacy.length} survive`);

  // And lowering the score to catch MORE chairs cannot help, because it lowers
  // the IoU threshold in lockstep.
  const lower = legacyCoupledSuppress(row, 0.05);
  check('lowering the score threshold does not recover them',
    lower.length <= legacy.length,
    `at 0.12 -> ${legacy.length} survive, at 0.05 -> ${lower.length} survive`);
}

{
  /*
   * The back of the room is the worse case, and the one that matters.
   * Perspective compresses distant rows, so chairs overlap far more in the image
   * than they do up front — here 70% spacing instead of 38%.
   */
  const tight: { box: Detection['box']; score: number; cls: 'chair' }[] = [];
  for (let i = 0; i < 8; i++) {
    tight.push({ box: box(200 + i * 22, 180, 74, 60), score: 0.3 - i * 0.015, cls: 'chair' });
  }

  const legacy = legacyCoupledSuppress(tight, 0.12);
  const fixed = suppressPerClass(tight);

  check('a compressed back row loses most of its chairs under coupled thresholds',
    legacy.length <= tight.length * 0.4,
    `${tight.length} chairs -> ${legacy.length} survive (${Math.round((1 - legacy.length / tight.length) * 100)}% lost)`);
  check('the same row survives with decoupled thresholds',
    fixed.length >= 6, `8 chairs -> ${fixed.length} survive`);
}

// =========================================================================
section('2. THE FIX — DECOUPLED THRESHOLDS');

{
  const row = chairRow(8);
  const fixed = suppressPerClass(row);

  check('decoupled suppression keeps the whole row', fixed.length === row.length,
    `${row.length} real chairs -> ${fixed.length} survive at IoU ${NMS_IOU_THRESHOLD}`);

  // Compared as numbers, not literals — TS narrows the consts to their literal
  // types and would otherwise reject the comparison as provably false.
  check('the two thresholds are genuinely independent',
    (NMS_SCORE_THRESHOLD as number) !== (NMS_IOU_THRESHOLD as number),
    `score ${NMS_SCORE_THRESHOLD}, IoU ${NMS_IOU_THRESHOLD}`);

  // True duplicates must still be removed, or we trade one bug for another.
  const withDupes = [
    ...row,
    { box: box(row[0].box.px + 4, row[0].box.py + 3, 90, 95), score: 0.2, cls: 'chair' as const },
  ];
  const deduped = suppressPerClass(withDupes);
  check('near-identical duplicates are still suppressed', deduped.length === row.length,
    `${withDupes.length} candidates -> ${deduped.length} kept`);
}

{
  // Class-agnostic suppression is the second half of the bug: a person sitting on
  // a chair overlaps it almost completely, so the person box deletes the chair.
  const chair = { box: box(400, 300, 90, 95), score: 0.28, cls: 'chair' as const };
  const person = { box: box(398, 240, 86, 170), score: 0.71, cls: 'person' as const };

  const legacy = legacyCoupledSuppress([chair, person], 0.12);
  check('class-agnostic suppression deletes the chair under the person',
    !legacy.some((c) => c.cls === 'chair'),
    `survivors: ${legacy.map((c) => c.cls).join(', ')}`);

  const fixed = suppressPerClass([chair, person]);
  check('per-class suppression keeps both',
    fixed.some((c) => c.cls === 'chair') && fixed.some((c) => c.cls === 'person'),
    `survivors: ${fixed.map((c) => c.cls).sort().join(', ')}`);
}

// =========================================================================
section('3. DECODING');

{
  // Two boxes, one clear chair and one clear person, laid out the way the SSD
  // head emits them: normalised [y1, x1, y2, x2].
  const numClasses = 90;
  const numBoxes = 2;
  const scores = new Float32Array(numBoxes * numClasses);
  const boxes = new Float32Array(numBoxes * 4);

  // Box 0 -> chair (class index 61), score 0.31
  scores[0 * numClasses + 61] = 0.31;
  boxes.set([0.5, 0.25, 0.75, 0.4], 0);
  // Box 1 -> person (class index 0), score 0.66
  scores[1 * numClasses + 0] = 0.66;
  boxes.set([0.3, 0.6, 0.8, 0.72], 4);

  const got = decodeCandidates(scores, boxes, numBoxes, numClasses, 1280, 720);

  check('decodes one candidate per qualifying class', got.length === 2, `${got.length}`);

  const chair = got.find((c) => c.cls === 'chair');
  // Tolerance, not equality: the score round-trips through a Float32Array, so
  // 0.31 comes back as 0.3100000023841858.
  check('chair class index maps correctly',
    chair !== undefined && Math.abs(chair.score - 0.31) < 1e-6,
    `score ${chair?.score.toFixed(6)}`);
  check('normalised box scales to frame pixels',
    chair !== undefined &&
      Math.abs(chair.box.px - 0.25 * 1280) < 0.01 &&
      Math.abs(chair.box.py - 0.5 * 720) < 0.01 &&
      Math.abs(chair.box.width - 0.15 * 1280) < 0.01,
    chair ? `${chair.box.px.toFixed(0)},${chair.box.py.toFixed(0)} ${chair.box.width.toFixed(0)}x${chair.box.height.toFixed(0)}` : 'none');

  check('sub-threshold boxes are dropped before suppression',
    decodeCandidates(
      (() => { const s = new Float32Array(numClasses); s[61] = 0.04; return s; })(),
      new Float32Array([0.1, 0.1, 0.2, 0.2]),
      1, numClasses, 1280, 720,
    ).length === 0,
    `floor is ${NMS_SCORE_THRESHOLD}`);

  // A box whose ARGMAX class is something else entirely still enters as a chair
  // if its chair score qualifies — coco-ssd would have thrown it away.
  const ambiguous = new Float32Array(numClasses);
  ambiguous[60] = 0.55; // dining table
  ambiguous[61] = 0.22; // chair
  const amb = decodeCandidates(ambiguous, new Float32Array([0.1, 0.1, 0.3, 0.3]), 1, numClasses, 1280, 720);
  check('a box whose top class is not chair can still yield a chair candidate',
    amb.length === 1 && amb[0].cls === 'chair',
    `argmax was class 60, chair score 0.22 -> ${amb.length} candidate(s)`);
}

// =========================================================================
section('4. THRESHOLDS AND CONFIRMATION');

{
  check('chair threshold is below the observed classroom band',
    CHAIR_MIN_SCORE <= 0.2, `${CHAIR_MIN_SCORE}`);
  check('chair threshold is lower than person', CHAIR_MIN_SCORE < PERSON_MIN_SCORE,
    `chair ${CHAIR_MIN_SCORE} < person ${PERSON_MIN_SCORE}`);
  check('per-class score floor sits below the chair threshold',
    NMS_SCORE_THRESHOLD < CHAIR_MIN_SCORE,
    `floor ${NMS_SCORE_THRESHOLD} < chair cut ${CHAIR_MIN_SCORE}`);

  // Only CONFIRMED chairs get scored and drawn, so requiring two consecutive hits
  // was silently costing coverage on any chair detection flickered on.
  check('chairs confirm on a single sighting', CONFIRM_HITS.chair === 1,
    `chair ${CONFIRM_HITS.chair}, person ${CONFIRM_HITS.person}`);
  check('people still need corroboration before firing a round',
    CONFIRM_HITS.person >= 2, `${CONFIRM_HITS.person}`);

  check('bench and couch fold into chair for recall',
    CLASS_INDEX_TO_TRACK[14] === 'chair' && CLASS_INDEX_TO_TRACK[62] === 'chair',
    'bench(14) and couch(63) both map to chair');
}

// =========================================================================
section('5. SCALE');

{
  // A packed room: 30 chairs in rows plus 20 people. Nothing may be lost to a cap.
  const many: { box: Detection['box']; score: number; cls: 'chair' | 'person' }[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 6; c++) {
      many.push({ box: box(80 + c * 60, 200 + r * 80, 88, 92), score: 0.3, cls: 'chair' });
    }
  }
  for (let i = 0; i < 20; i++) {
    many.push({ box: box(70 + i * 55, 180, 70, 175), score: 0.5, cls: 'person' });
  }

  const kept = suppressPerClass(many);
  const chairs = kept.filter((k) => k.cls === 'chair').length;
  const people = kept.filter((k) => k.cls === 'person').length;

  check('a 30-chair room survives suppression largely intact', chairs >= 24,
    `30 chairs in -> ${chairs} kept`);
  check('people are suppressed independently of chairs', people >= 15,
    `20 people in -> ${people} kept`);
  check('total output is not capped near the old ceiling', kept.length > 20,
    `${kept.length} detections`);
}

// =========================================================================
console.log();
console.log('═'.repeat(78));
if (failures === 0) {
  console.log(`ALL ${passes} ASSERTIONS PASSED.`);
  console.log('Synthetic geometry only. Real recall still needs a camera on a real room.');
} else {
  console.log(`${failures} FAILURE(S), ${passes} passed.`);
  process.exitCode = 1;
}
console.log('═'.repeat(78));
