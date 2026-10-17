/**
 * How many plants a batch is expected to yield — ONE definition (HARV-07).
 *
 * This lived in two places: `harvest.service` used it to decide when a batch was
 * finished, and `plant-stock.service` used a *different* version to fill the
 * "expected / remaining" columns on the plant-stock screen. Two copies of the
 * same sum is how a screen and a refusal come to disagree about the same batch —
 * the operator is told 800 are left and is then refused a harvest of 500.
 *
 * The one difference that mattered: the plant-stock copy multiplied by
 * `seedsPerTray ?? 0`, so a batch that never recorded a seeds-per-tray expected
 * **zero** plants and showed a NEGATIVE "remaining". The harvest side had already
 * been fixed to fall back instead (HARV-01); the screen had not. Both now come
 * through here.
 *
 * Erring high is the safe direction in every fallback below: a batch that looks
 * like it still has plants simply stays open, which is what a harvest nobody has
 * logged yet looks like. Erring low silently hides work still to come.
 */

/** The batch facts this needs. Deliberately narrow, so both callers fit. */
export type ExpectationFacts = {
  /** What the batch as a whole was expected to yield, recorded at sowing. */
  expectedPlants: number;
  /** Seeds per tray — null on a batch that never recorded one. */
  seedsPerTray: number | null;
  /** Trays the batch was sown as a whole. */
  numberOfTrays: number | null;
};

/**
 * What a given number of trays of a batch should yield.
 *
 * `trays` is the trays in ONE place (a tunnel), not the whole batch: a batch
 * split over two tunnels can be harvested out of one of them on its own.
 *
 * Falls back in two steps when the batch did not record what it needs:
 *   1. trays × seeds per tray — the normal case;
 *   2. the batch's own expectation, split by trays — when there is no
 *      seeds-per-tray but the tray counts are known;
 *   3. the batch's own expectation whole — when neither is known.
 */
export function predictedPlantsForTrays(
  batch: ExpectationFacts,
  trays: number,
): number {
  if (batch.seedsPerTray && batch.seedsPerTray > 0) {
    return trays * batch.seedsPerTray;
  }

  if (batch.numberOfTrays && batch.numberOfTrays > 0) {
    return Math.round(batch.expectedPlants * (trays / batch.numberOfTrays));
  }

  return batch.expectedPlants;
}
