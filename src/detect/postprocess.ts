import type { Detection, TrackClass } from '../models/types';

/**
 * Own SSD post-processing, replacing coco-ssd's `detect()`.
 *
 * WHY THIS EXISTS — the root cause of "only 1-2 chairs detected".
 *
 * coco-ssd 2.2.3 does this (dist/index.js:165):
 *
 *     tf.image.nonMaxSuppression(boxes2, maxScores, maxNumBoxes, minScore, minScore)
 *
 * The signature is (boxes, scores, maxOutputSize, iouThreshold, scoreThreshold),
 * so it passes `minScore` as BOTH thresholds. Asking for a low score threshold —
 * which classroom chairs need, they score 0.15-0.35 — therefore also sets the IoU
 * threshold that low. At iouThreshold 0.12, any two boxes overlapping by more than
 * 12% are treated as duplicates and the weaker one is deleted. Chairs in a row at
 * an oblique angle overlap far more than that, so they suppress each other and one
 * or two survivors come back.
 *
 * The two parameters are inversely coupled against us: lowering the score to catch
 * more chairs makes the suppression more aggressive, raising it to fix suppression
 * throws the chairs away. No single value works, which is why the library is only
 * well-behaved at its own default of 0.5.
 *
 * It is also CLASS-AGNOSTIC. `calculateMaxScores` reduces every box to one score,
 * the max across all 80 classes, so a person box can suppress the chair box behind
 * them. In a room where people sit on chairs, that is systematic.
 *
 * So we run the model ourselves and do suppression properly:
 *   - score threshold and IoU threshold are SEPARATE knobs
 *   - suppression is PER CLASS, so a person never suppresses a chair
 *
 * Falls back to the library path if the output tensors are not the shape we
 * expect, so a future version bump degrades instead of breaking.
 */

// ===========================================================================
// TUNING — the two numbers that were previously forced to be equal.
// ===========================================================================

/**
 * Minimum score to consider a box at all. Deliberately low: real classroom
 * chairs live in the 0.15-0.35 band. Per-class thresholds are applied after this
 * in detector.ts, so this is only the floor for entering suppression.
 */
export const NMS_SCORE_THRESHOLD = 0.1;

/**
 * IoU above which two boxes OF THE SAME CLASS are treated as duplicates.
 *
 * 0.55 rather than the conventional 0.5 because adjacent chairs in a row
 * legitimately overlap a lot from an oblique camera angle, and we would rather
 * keep an occasional duplicate — the tracker merges those by centroid — than
 * delete a real chair.
 */
export const NMS_IOU_THRESHOLD = 0.55;

/** Hard ceiling per class, so a pathological frame cannot produce thousands. */
export const MAX_PER_CLASS = 80;

/**
 * COCO class index -> our internal class.
 *
 * Index is the CLASSES map id minus one, matching coco-ssd's own
 * `CLASSES[classes[i] + 1]` lookup. Verified against the installed package:
 * person id 1, bench 15, chair 62, couch 63.
 *
 * bench and couch fold into 'chair' because classroom seating is frequently
 * labelled as one of those, and folding them materially improves recall.
 */
export const CLASS_INDEX_TO_TRACK: Record<number, TrackClass> = {
  0: 'person',
  14: 'chair',
  61: 'chair',
  62: 'chair',
};

// ===========================================================================

interface Candidate {
  box: Detection['box'];
  score: number;
  cls: TrackClass;
}

/** Axis-aligned IoU. Local copy so this module stays dependency-free. */
function iou(a: Detection['box'], b: Detection['box']): number {
  const ax2 = a.px + a.width;
  const ay2 = a.py + a.height;
  const bx2 = b.px + b.width;
  const by2 = b.py + b.height;

  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.px, b.px));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.py, b.py));
  const inter = ix * iy;
  if (inter <= 0) return 0;

  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

/**
 * Greedy non-max suppression over one class.
 *
 * Standard algorithm: take the highest-scoring box, drop everything overlapping
 * it beyond the threshold, repeat. O(n²) worst case, but n is a few dozen per
 * class so it is far cheaper than the inference that produced it.
 */
export function suppressPerClass(
  candidates: readonly Candidate[],
  iouThreshold = NMS_IOU_THRESHOLD,
  maxPerClass = MAX_PER_CLASS,
): Candidate[] {
  const byClass = new Map<TrackClass, Candidate[]>();
  for (const c of candidates) {
    const list = byClass.get(c.cls);
    if (list) list.push(c);
    else byClass.set(c.cls, [c]);
  }

  const kept: Candidate[] = [];

  for (const list of byClass.values()) {
    const sorted = [...list].sort((a, b) => b.score - a.score);
    const survivors: Candidate[] = [];

    for (const cand of sorted) {
      if (survivors.length >= maxPerClass) break;
      let suppressed = false;
      for (const s of survivors) {
        if (iou(cand.box, s.box) > iouThreshold) {
          suppressed = true;
          break;
        }
      }
      if (!suppressed) survivors.push(cand);
    }

    kept.push(...survivors);
  }

  return kept;
}

/**
 * Decode raw SSD output into candidate detections.
 *
 * Layout, matching coco-ssd's own reads:
 *   scores: flat, [numBoxes * numClasses], indexed `i * numClasses + j`
 *   boxes:  flat, [numBoxes * 4], normalised [y1, x1, y2, x2]
 *
 * Only the classes we care about are considered, so a box whose top class is
 * "dining table" but which also carries a decent "chair" score still enters as a
 * chair candidate. That is a deliberate recall win over coco-ssd's argmax, which
 * would have thrown the box away as a table.
 */
export function decodeCandidates(
  scores: Float32Array | Int32Array | Uint8Array,
  boxes: Float32Array | Int32Array | Uint8Array,
  numBoxes: number,
  numClasses: number,
  frameWidth: number,
  frameHeight: number,
  scoreThreshold = NMS_SCORE_THRESHOLD,
): Candidate[] {
  const out: Candidate[] = [];

  for (let i = 0; i < numBoxes; i++) {
    for (const key of Object.keys(CLASS_INDEX_TO_TRACK)) {
      const j = Number(key);
      if (j >= numClasses) continue;

      const score = scores[i * numClasses + j];
      if (!(score >= scoreThreshold)) continue;

      const y1 = boxes[i * 4] * frameHeight;
      const x1 = boxes[i * 4 + 1] * frameWidth;
      const y2 = boxes[i * 4 + 2] * frameHeight;
      const x2 = boxes[i * 4 + 3] * frameWidth;

      const width = x2 - x1;
      const height = y2 - y1;
      // Degenerate boxes break centroid and angular maths downstream.
      if (width <= 1 || height <= 1) continue;

      out.push({
        box: { px: x1, py: y1, width, height },
        score,
        cls: CLASS_INDEX_TO_TRACK[j],
      });
    }
  }

  return out;
}
