import { centroid, distance } from './geometry2d';
import type { Box, Detection, Track, TrackClass } from '../models/types';

// ===========================================================================
// TRACKING CONSTANTS
// ===========================================================================

/**
 * Max centroid movement between ticks for a detection to be considered the
 * same object, as a FRACTION OF THE FRAME DIAGONAL.
 *
 * Expressed as a fraction rather than raw pixels so the tracker behaves the
 * same on a 640x480 laptop webcam and a 1920x1080 hall camera. At 1.5Hz a
 * seated person's box wanders a few percent of the diagonal at most; anything
 * further is a different object.
 */
export const MAX_MATCH_DISTANCE_FRAC = 0.05;

/** Placeholder for the audit; tuned below. */
export const PERSON_MATCH_DISTANCE_FRAC = 0.05;

/**
 * Consecutive sightings before a track is trusted and drawn solid.
 *
 * PER CLASS, and the asymmetry is deliberate:
 *
 *  chair: 1 — a chair does not move. If the model saw it once it is almost
 *    certainly there, and DROP_AFTER_MISSES already stops it flickering out.
 *    Requiring two consecutive hits was actively costing coverage: a chair that
 *    detection caught on alternating ticks never confirmed, and only confirmed
 *    chairs get scored and drawn, so it never got a badge at all.
 *
 *  person: 2 — people move, and a false-positive person fires the Screen 2
 *    auto-trigger. Worth one tick of latency to avoid rounds starting at random.
 */
export const CONFIRM_HITS: Record<TrackClass, number> = {
  chair: 1,
  person: 2,
};

/** Consecutive misses before a track is deleted. */
export const DROP_AFTER_MISSES = 4;

/**
 * Box smoothing weight for new observations (EMA). Lower = steadier box, but
 * slower to follow real movement. 0.4 kills visible jitter while still keeping
 * up with someone shifting in their seat.
 */
export const BOX_SMOOTHING = 0.4;

// ===========================================================================

let idCounter = 0;
function nextId(cls: TrackClass): string {
  idCounter += 1;
  return `${cls === 'chair' ? 'SEAT' : 'OCC'}-${String(idCounter).padStart(3, '0')}`;
}

/** Reset id allocation. Only for tests and for a fresh scan. */
export function resetIdCounter(): void {
  idCounter = 0;
}

/**
 * Centroid nearest-neighbour tracker, one instance per class.
 *
 * Why this and not something fancier: at 1.5Hz with mostly-stationary objects,
 * centroid distance is a completely adequate association metric. A Kalman
 * filter or IoU-based Hungarian assignment would add real complexity for no
 * demo-visible benefit.
 *
 * Matching is GLOBALLY GREEDY rather than per-track nearest. Taking each
 * track's nearest detection in turn lets an early track steal a detection that
 * was a much better fit for a later one, which produces exactly the ID
 * reshuffling this class exists to prevent. Sorting all candidate pairs by
 * distance and consuming them in order avoids that for a few lines of code.
 */
export class CentroidTracker {
  private tracks = new Map<string, Track>();
  private tick = 0;

  constructor(
    private cls: TrackClass,
    // The default reads CONFIRM_HITS for THIS class — a later default parameter
    // may reference an earlier one, so `cls` is in scope here.
    private config = {
      maxMatchDistanceFrac: MAX_MATCH_DISTANCE_FRAC,
      confirmHits: CONFIRM_HITS[cls],
      dropAfterMisses: DROP_AFTER_MISSES,
      boxSmoothing: BOX_SMOOTHING,
    },
  ) {}

  update(
    detections: readonly Detection[],
    frameWidth: number,
    frameHeight: number,
  ): Track[] {
    this.tick += 1;

    const dets = detections.filter((d) => d.cls === this.cls);
    const frameDiagonal = Math.hypot(frameWidth, frameHeight);
    const maxDist = frameDiagonal * this.config.maxMatchDistanceFrac;

    // Build every candidate pair within the gate, then consume greedily by
    // ascending distance.
    const pairs: { trackId: string; detIndex: number; dist: number }[] = [];
    for (const [trackId, track] of this.tracks) {
      for (let i = 0; i < dets.length; i++) {
        const d = distance(track.centroid, centroid(dets[i].box));
        if (d <= maxDist) pairs.push({ trackId, detIndex: i, dist: d });
      }
    }
    pairs.sort((a, b) => a.dist - b.dist);

    const usedTracks = new Set<string>();
    const usedDets = new Set<number>();

    for (const pair of pairs) {
      if (usedTracks.has(pair.trackId) || usedDets.has(pair.detIndex)) continue;
      usedTracks.add(pair.trackId);
      usedDets.add(pair.detIndex);

      const track = this.tracks.get(pair.trackId)!;
      const det = dets[pair.detIndex];

      track.rawBox = det.box;
      track.box = smoothBox(track.box, det.box, this.config.boxSmoothing);
      track.centroid = centroid(track.box);
      track.score = det.score;
      track.hitStreak += 1;
      track.missStreak = 0;
      track.lastTick = this.tick;
      if (!track.confirmed && track.hitStreak >= this.config.confirmHits) {
        track.confirmed = true;
      }
    }

    // Unmatched detections become new tracks.
    for (let i = 0; i < dets.length; i++) {
      if (usedDets.has(i)) continue;
      const det = dets[i];
      const id = nextId(this.cls);
      this.tracks.set(id, {
        id,
        cls: this.cls,
        box: det.box,
        rawBox: det.box,
        score: det.score,
        centroid: centroid(det.box),
        hitStreak: 1,
        missStreak: 0,
        confirmed: this.config.confirmHits <= 1,
        firstTick: this.tick,
        lastTick: this.tick,
      });
    }

    // Unmatched tracks age out. Note they are NOT dropped on a single miss —
    // the box keeps its last known position so the overlay stays stable while
    // the detector has a bad frame.
    for (const [trackId, track] of this.tracks) {
      if (usedTracks.has(trackId)) continue;
      track.missStreak += 1;
      track.hitStreak = 0;
      if (track.missStreak >= this.config.dropAfterMisses) {
        this.tracks.delete(trackId);
      }
    }

    return this.all();
  }

  all(): Track[] {
    return [...this.tracks.values()];
  }

  confirmed(): Track[] {
    return this.all().filter((t) => t.confirmed);
  }

  reset(): void {
    this.tracks.clear();
    this.tick = 0;
  }

  get tickCount(): number {
    return this.tick;
  }
}

function smoothBox(prev: Box, next: Box, alpha: number): Box {
  const blend = (a: number, b: number) => a * (1 - alpha) + b * alpha;
  return {
    px: blend(prev.px, next.px),
    py: blend(prev.py, next.py),
    width: blend(prev.width, next.width),
    height: blend(prev.height, next.height),
  };
}
