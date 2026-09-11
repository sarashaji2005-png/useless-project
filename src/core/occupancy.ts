import { boxBottom, boxRight, iou, pointInBox } from './geometry2d';
import type { Occupant, Track } from '../models/types';

// ===========================================================================
// OCCUPANCY CONSTANTS
// ===========================================================================

/**
 * IoU above this and a person is considered to be sitting on the chair.
 *
 * Kept low on purpose. A seated person's box and their chair's box are never
 * close to identical: the person box covers head and torso rising well above
 * the seat, while the chair box is mostly hidden behind them. Real IoU for a
 * genuine seated pair typically lands in the 0.15-0.4 range, not 0.7.
 */
export const OCCUPANCY_IOU_THRESHOLD = 0.15;

/**
 * Fallback rule margin, as a fraction of the chair box size.
 *
 * IoU alone fails in a common case: the camera sees a person from the front, so
 * their box sits mostly ABOVE the chair box with little overlap. Testing
 * whether the person's bottom-centre (roughly where they meet the seat) lands
 * in or near the chair box catches those.
 */
export const BOTTOM_CENTRE_MARGIN_FRAC = 0.35;

// ===========================================================================

export interface OccupancyResult {
  occupants: Occupant[];
  /** Chair track id -> occupant, for fast lookup during scoring. */
  byChair: Map<string, Occupant>;
  /** Person track ids that were matched to some chair. */
  seatedPersonIds: Set<string>;
}

/**
 * Match people to chairs.
 *
 * Both rules run; IoU is preferred and reported as the match rule when it
 * fires, with bottom-centre as the fallback. Which rule fired is recorded on
 * the Occupant so threshold tuning against real footage is evidence-based
 * rather than guesswork.
 *
 * Each chair takes at most ONE occupant — the best-scoring candidate. Without
 * that, a person standing between two chairs marks both occupied.
 */
export function computeOccupancy(
  chairs: readonly Track[],
  people: readonly Track[],
  now: number,
): OccupancyResult {
  const candidates: {
    chairId: string;
    personId: string;
    iouValue: number;
    rule: 'iou' | 'bottom-centre';
  }[] = [];

  for (const chair of chairs) {
    for (const person of people) {
      const iouValue = iou(chair.box, person.box);

      if (iouValue >= OCCUPANCY_IOU_THRESHOLD) {
        candidates.push({ chairId: chair.id, personId: person.id, iouValue, rule: 'iou' });
        continue;
      }

      const bottomCentre = {
        x: (person.box.px + boxRight(person.box)) / 2,
        y: boxBottom(person.box),
      };
      const margin =
        Math.max(chair.box.width, chair.box.height) * BOTTOM_CENTRE_MARGIN_FRAC;
      if (pointInBox(bottomCentre, chair.box, margin)) {
        candidates.push({
          chairId: chair.id,
          personId: person.id,
          iouValue,
          rule: 'bottom-centre',
        });
      }
    }
  }

  // Best candidate per chair. IoU matches outrank bottom-centre matches, then
  // higher IoU wins.
  const bestByChair = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) {
    const incumbent = bestByChair.get(c.chairId);
    if (!incumbent) {
      bestByChair.set(c.chairId, c);
      continue;
    }
    const better =
      (c.rule === 'iou' && incumbent.rule !== 'iou') ||
      (c.rule === incumbent.rule && c.iouValue > incumbent.iouValue);
    if (better) bestByChair.set(c.chairId, c);
  }

  // A person cannot occupy two chairs. Where they claim several, keep the
  // strongest claim only.
  const bestByPerson = new Map<string, (typeof candidates)[number]>();
  for (const c of bestByChair.values()) {
    const incumbent = bestByPerson.get(c.personId);
    if (!incumbent || c.iouValue > incumbent.iouValue) {
      bestByPerson.set(c.personId, c);
    }
  }
  const finalClaims = new Set([...bestByPerson.values()]);

  const occupants: Occupant[] = [];
  const byChair = new Map<string, Occupant>();
  const seatedPersonIds = new Set<string>();

  for (const claim of finalClaims) {
    const occupant: Occupant = {
      seatId: claim.chairId,
      present: true,
      // Left undefined deliberately: on the screen-space path there is no
      // pixel-to-centimetre conversion, so any value here would be invented.
      estimatedHeightCm: undefined,
      detectedAt: now,
      personTrackId: claim.personId,
      matchRule: claim.rule,
      matchIou: Math.round(claim.iouValue * 1000) / 1000,
    };
    occupants.push(occupant);
    byChair.set(claim.chairId, occupant);
    seatedPersonIds.add(claim.personId);
  }

  return { occupants, byChair, seatedPersonIds };
}
