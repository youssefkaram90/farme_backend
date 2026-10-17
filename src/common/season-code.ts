/**
 * The single 1-July season rule.
 *
 * Season boundaries are read and written in UTC (decided 2026-09-30): a stored
 * instant must not shift when the server or a container changes timezone, and a
 * UTC ISO string from a client has to land in the season it names.
 *
 * A season's boundaries are STORED on its row and never recomputed, so a change
 * to this rule cannot re-label an existing season. Anything that needs to know
 * which season a date falls in must READ THE ROW — see
 * `SeasonService.assertDateInSeason()` — never compute it from this rule.
 */
export const SEASON_START_MONTH = 7;
export const SEASON_START_DAY = 1;

const SEASON_CODE_PATTERN = /^(\d{2})-(\d{2})$/;

function twoDigits(year: number): string {
  return String(year % 100).padStart(2, '0');
}

/** 2026 -> "26-27" */
export function seasonCodeFromStartYear(startYear: number): string {
  return `${twoDigits(startYear)}-${twoDigits(startYear + 1)}`;
}

/**
 * True when the code is well formed AND its two years are consecutive,
 * so "26-28" and "6-27" are both rejected.
 *
 * This is the authority for the rule. `Frontend/app/(app)/seasons/page.tsx`
 * mirrors it by hand so the create form can answer without a round-trip — if
 * this rule changes, change that copy too.
 */
export function isValidSeasonCode(code: string): boolean {
  const match = SEASON_CODE_PATTERN.exec(code);
  if (!match) return false;
  return Number(match[2]) === (Number(match[1]) + 1) % 100;
}

/** "26-27" -> 2026. Assumes the code is valid; call isValidSeasonCode first. */
export function startYearFromCode(code: string): number {
  const match = SEASON_CODE_PATTERN.exec(code);
  if (!match) {
    throw new Error(`Not a season code: ${code}`);
  }
  return 2000 + Number(match[1]);
}

/** "26-27" -> "27-28" */
export function nextSeasonCode(code: string): string {
  return seasonCodeFromStartYear(startYearFromCode(code) + 1);
}

/**
 * The exact instant boundaries of a season code. Used when creating a season,
 * then stored on the row so later queries never recompute them.
 */
export function seasonBounds(startYear: number): {
  startDate: Date;
  endDate: Date;
} {
  return {
    // 1 July, 00:00:00.000 UTC
    startDate: new Date(
      Date.UTC(startYear, SEASON_START_MONTH - 1, SEASON_START_DAY),
    ),
    // 30 June, 23:59:59.999 UTC — day 0 of July is the last day of June
    endDate: new Date(
      Date.UTC(startYear + 1, SEASON_START_MONTH - 1, 0, 23, 59, 59, 999),
    ),
  };
}

/**
 * "30 Jun 2027" — how a season boundary is shown to a user. Always UTC, to match
 * the stored instants.
 */
export function formatSeasonDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
