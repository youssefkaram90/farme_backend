import { UNASSIGNED_LOCATION } from '../common/sowing.constants';

/**
 * The stages a batch of plants goes through (PSTOCK-05, decided 2026-10-08).
 *
 * TWO words, on the user's decision: a batch is either still growing
 * (`SEEDLING`) or it has been finished off (`HARVESTED`). The vocabulary is
 * kept small on purpose, so a screen can show it whole and nobody has to guess
 * what a third word would mean.
 *
 * The column stays a `String` — no database enum, no migration: the list is
 * free to grow, and a migration is the wrong price for a word.
 *
 * WHO WRITES IT: only the server. A sowing creates the batch as `SEEDLING`; the
 * harvest moves it to `HARVESTED` when nothing of the batch is left, and back
 * to `SEEDLING` when that harvest is removed again. Nobody types a stage, which
 * is why `PLANT_STAGES` is here to judge what comes IN (`?stage=`, the update
 * body) rather than to draw a picker.
 *
 * A stage the list does not know is REFUSED, with `notAPlantStage` below. It
 * used to be passed straight into the query, so `?stage=SEEDLNG` answered
 * "no plant stock found" — a typo that looks exactly like an empty season.
 */
export const PLANT_STAGES = ['SEEDLING', 'HARVESTED'] as const;
export type PlantStage = (typeof PLANT_STAGES)[number];

/** Named handles for the writers, so no service spells a stage out itself. */
export const STAGE_SEEDLING: PlantStage = PLANT_STAGES[0];
export const STAGE_HARVESTED: PlantStage = PLANT_STAGES[1];

export function isPlantStage(value: string): value is PlantStage {
  return (PLANT_STAGES as readonly string[]).includes(value);
}

/**
 * The one refusal, built from the list above so the wording and the list can
 * never disagree. Plain language, and it names the choices — this text is shown
 * to the person who typed the value, on the web and on the phone alike.
 */
export function notAPlantStage(value: string): string {
  return `There is no plant stage called "${value}". A batch is either ${PLANT_STAGES.join(
    ' or ',
  )}.`;
}

/**
 * The number at the end of a tunnel number: `T1` → 1, `B12` → 12, `1` → 1.
 *
 * A SECTOR is named in words (`Sector 2`, `Field 12`), so it does not match and
 * is treated as text. That is the whole reason this expression is anchored: the
 * web used to pull the digits out of any location, which ordered the LPM list by
 * the numbers inside a name (PSTOCK-18).
 *
 * `Infinity` means "not a tunnel number", which sorts after every number.
 */
const locationNumber = (location: string): number => {
  const match = /^[A-Za-z]*(\d+)$/.exec(location.trim());
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

/**
 * Display order for the plant-stock rows (PSTOCK-18, decided 2026-10-09).
 *
 * The rows arrive as one list and are grouped into locations by the clients, so
 * the order of this array IS the order of the tunnel/sector table on both
 * screens. Each client used to sort the groups itself — the web by the digits
 * inside the name, the phone by size — so the same screen listed the same
 * tunnels differently depending on which device you were holding, and a sector
 * name was ordered by a number that means nothing.
 *
 * The rule, in words: `Not assigned` FIRST (the bucket of trays that have not
 * been placed anywhere — the user's decision: it is the thing you act on, not a
 * place you look up), then tunnels by their number (`T2` before `T10`), then
 * everything else by name.
 */
export function compareLocations(a: string, b: string): number {
  if (a === b) return 0;
  if (a === UNASSIGNED_LOCATION) return -1;
  if (b === UNASSIGNED_LOCATION) return 1;

  const numberA = locationNumber(a);
  const numberB = locationNumber(b);

  // Both numbers, or both names, or one of each — `Infinity` handles all three.
  if (numberA !== numberB) return numberA - numberB;

  return a.localeCompare(b, 'en');
}
