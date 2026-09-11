import type { Detection, TrackClass } from '../models/types';

// ===========================================================================
// TUNING CONSTANTS — deliberately at the top of the module, not buried.
// These are the first things to change when real classroom footage disappoints.
// ===========================================================================

/**
 * Person confidence threshold.
 *
 * Lowered from 0.50. COCO-SSD is strong on an unobstructed person facing the
 * camera, but a classroom is the opposite case: people are seen obliquely, half
 * behind each other, and small at the back of the room. Those routinely score
 * 0.3-0.5, and at 0.50 they were being dropped silently — real people simply
 * never appearing in occupancy.
 *
 * The cost of 0.35 is more false positives on coats, bags and monitors. The
 * tracker's two-hit confirmation absorbs most of them, because junk detections
 * rarely persist in the same place for consecutive ticks.
 */
export const PERSON_MIN_SCORE = 0.35;

/**
 * Chair confidence threshold — deliberately much lower than person.
 *
 * Chairs in a real classroom shot are a genuinely hard case for COCO-SSD:
 * they are heavily occluded by the people sitting on them, seen from an
 * oblique angle, overlapping each other in rows, and often only visible as a
 * backrest. Scores in the 0.15-0.35 band are common and usable. At 0.5 you
 * will detect almost nothing, which is the failure mode most likely to make
 * the demo look broken.
 *
 * The cost of going this low is false positives on desks, bags and monitors.
 * The tracker's confirmation requirement absorbs most of those, since junk
 * detections rarely persist in the same place for consecutive ticks.
 */
export const CHAIR_MIN_SCORE = 0.2;

/**
 * Max boxes per frame.
 *
 * Raised from 60. This cap is shared across ALL classes — a room with 30 chairs
 * and 25 people needs 55 slots before anything is dropped at all, and the chair
 * threshold is deliberately low so low-confidence chair boxes compete for the same
 * budget. Being anywhere near the ceiling silently loses whichever detections NMS
 * ranks last, and people at the back of the room are exactly those.
 */
export const MAX_BOXES = 100;

/**
 * Score COCO-SSD is asked to filter at internally. Set below CHAIR_MIN_SCORE
 * so we receive the low-confidence chairs and can apply our own per-class
 * thresholds rather than having the model discard them first.
 */
export const MODEL_MIN_SCORE = 0.12;

/** COCO labels we keep. Everything else is discarded. */
const KEPT_CLASSES: Record<string, TrackClass> = {
  chair: 'chair',
  person: 'person',
  // COCO has several seat-like classes. A classroom chair is frequently
  // labelled as one of these instead, especially padded or bench seating, so
  // folding them into 'chair' materially improves recall.
  bench: 'chair',
  couch: 'chair',
};

export const CLASS_THRESHOLDS: Record<TrackClass, number> = {
  person: PERSON_MIN_SCORE,
  chair: CHAIR_MIN_SCORE,
};

// ===========================================================================

type CocoModel = {
  detect: (
    input: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement,
    maxNumBoxes?: number,
    minScore?: number,
  ) => Promise<{ bbox: [number, number, number, number]; class: string; score: number }[]>;
};

export type DetectorStatus = 'idle' | 'loading' | 'ready' | 'failed';

let modelPromise: Promise<CocoModel> | null = null;

/**
 * Lazily load COCO-SSD. Dynamic import keeps several MB of tfjs out of the
 * initial bundle so the page itself boots instantly.
 *
 * Using mobilenet_v2 rather than lite_mobilenet_v2: the lite variant is
 * noticeably worse on small, partially-occluded objects, which is exactly what
 * a classroom chair is. At a 1.5Hz tick we can afford the heavier model, and
 * chair recall is the whole ballgame here.
 */
export async function loadDetector(): Promise<CocoModel> {
  if (modelPromise) return modelPromise;

  modelPromise = (async () => {
    const [tf, cocoSsd] = await Promise.all([
      import('@tensorflow/tfjs'),
      import('@tensorflow-models/coco-ssd'),
    ]);
    await tf.ready();
    return (await cocoSsd.load({ base: 'mobilenet_v2' })) as unknown as CocoModel;
  })();

  try {
    return await modelPromise;
  } catch (err) {
    modelPromise = null; // allow a retry
    throw err;
  }
}

export interface RawDetectionResult {
  detections: Detection[];
  /** Everything the model returned, before per-class thresholding. */
  totalReturned: number;
  rawChairs: number;
  rawPeople: number;
  /** Highest chair score this tick. The key number for threshold tuning. */
  bestChairScore: number;
  /**
   * EVERY kept-class detection with its score, including ones below the
   * per-class threshold. This is the raw evidence for "is a real person being
   * dropped just under the cut" — without it you cannot tell a missing detection
   * from a filtered one.
   */
  scored: { cls: TrackClass; score: number; kept: boolean }[];
  inferenceMs: number;
}

export async function detectFrame(
  model: CocoModel,
  frame: HTMLCanvasElement,
): Promise<RawDetectionResult> {
  const t0 = performance.now();
  const raw = await model.detect(frame, MAX_BOXES, MODEL_MIN_SCORE);
  const inferenceMs = performance.now() - t0;

  const detections: Detection[] = [];
  const scored: { cls: TrackClass; score: number; kept: boolean }[] = [];
  let rawChairs = 0;
  let rawPeople = 0;
  let bestChairScore = 0;

  for (const r of raw) {
    const cls = KEPT_CLASSES[r.class];
    if (!cls) continue;

    if (cls === 'chair') {
      rawChairs++;
      bestChairScore = Math.max(bestChairScore, r.score);
    } else {
      rawPeople++;
    }

    const kept = r.score >= CLASS_THRESHOLDS[cls];
    scored.push({ cls, score: r.score, kept });
    if (!kept) continue;

    const [px, py, width, height] = r.bbox;
    // Degenerate boxes occasionally come back from the model; they break
    // centroid and angular maths downstream.
    if (width <= 1 || height <= 1) continue;

    detections.push({ box: { px, py, width, height }, score: r.score, cls });
  }

  return {
    detections,
    totalReturned: raw.length,
    rawChairs,
    rawPeople,
    bestChairScore,
    scored,
    inferenceMs,
  };
}
