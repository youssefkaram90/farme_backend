/**
 * Physical layout constants for sowing.
 *
 * LPM (field) beds are always drilled with 7 rows per line. Every conversion
 * between line-metres and row-metres must go through this module — it is the
 * single definition shared by sowing density, plan forecasts and plant counting
 * so the three can never drift apart.
 */

/** Rows per line on LPM (field) beds. */
export const ROWS_PER_LINE = 7;

/**
 * Trays per big ball of peat.
 *
 * Peat is bought and counted in balls, while every sowing screen talks in trays,
 * so the conversion happens on both sides of the ledger. It was written out as a
 * bare `380` in five places in one file (LPM-02) — this is that one place now.
 */
export const TRAYS_PER_PEAT_BALL = 380;

/**
 * Seeds per tray when the sowing screen does not say.
 *
 * A real supplier figure, so it belongs next to the other physical constants
 * rather than inside the service that happens to use it first.
 */
export const DEFAULT_SEEDS_PER_TRAY = 285;

/**
 * Where a batch sits before its trays have been transported — and where the
 * trays that are still WAITING are reported (PSTOCK-22).
 *
 * This is a value, not a label: the clients group their location lists by this
 * exact text (`r.location || "Not assigned"`), so changing the string changes
 * what the screens show.
 */
export const UNASSIGNED_LOCATION = 'Not assigned';

/**
 * Two spellings of the same variety are the same variety.
 *
 * `toLowerCase()` and `toLocaleLowerCase()` disagree on a Turkish keyboard (the
 * dotted and dotless i are different letters there), and the execute path used
 * one while the edit path used the other (LPM-02) — so the same variety, typed
 * the same way, could match on one path and not the other. One comparison, one
 * answer, and it ignores surrounding spaces so a paste does not fail the check.
 */
export function sameVariety(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Row-metres covered by an LPM sowing: every row of every line.
 *
 *   lines x metresPerLine = line-metres (one row per line)
 *   ... x ROWS_PER_LINE   = row-metres (all rows)
 *
 * Seed density (`seedsPerMeter`) is stored per ROW-metre, so any total that is
 * compared against or derived from it must be expressed in row-metres too.
 */
export function toRowMetres(lines: number, metresPerLine: number): number {
  return lines * metresPerLine * ROWS_PER_LINE;
}

/**
 * Seeds per row-metre, derived from the seed quantity actually being used.
 *
 * `seedsPerMeter` is never accepted as input — it is always calculated, so a
 * plan forecast and the sowing that executes it can never disagree about it.
 */
export function deriveSeedsPerRowMetre(
  seeds?: number | null,
  lines?: number | null,
  metresPerLine?: number | null,
): number | undefined {
  if (!seeds || !lines || !metresPerLine) return undefined;
  const rowMetres = toRowMetres(lines, metresPerLine);
  return rowMetres > 0 ? Math.round(seeds / rowMetres) : undefined;
}

/**
 * The density a field (LPM) line is PLANNED at, in seeds per row-metre.
 *
 * This is the rate the farm WISHES, and it is the same for every variety: it exists
 * so a planner can say what a line needs without working out a seed total by hand
 * (user, 2026-10-11).
 *
 * It is a SETTING (SOW-11), so the farm can change it without a developer — and
 * every plan entry stores the rate it was planned with, so changing this does not
 * rewrite plans already made.
 *
 * PLANNING ONLY. A plan is a forecast; what a sowing actually used is recorded when
 * it is executed, from the seed that really went in.
 */
export const DEFAULT_SEEDS_PER_ROW_METRE = 120;

/**
 * The seeds one field (LPM) line needs, from the density it is planned at — the
 * inverse of `deriveSeedsPerRowMetre`, and the formula the planners use:
 *
 *   seeds = lines x metresPerLine x ROWS_PER_LINE x seeds per row-metre
 *
 * Returns undefined when a figure is missing, so a caller can refuse in its own
 * words instead of storing a zero.
 */
export function plannedSeedsFromRate(
  seedsPerRowMetre?: number | null,
  lines?: number | null,
  metresPerLine?: number | null,
): number | undefined {
  if (!seedsPerRowMetre || !lines || !metresPerLine) return undefined;
  return Math.round(toRowMetres(lines, metresPerLine) * seedsPerRowMetre);
}
