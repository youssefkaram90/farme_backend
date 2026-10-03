import { Transform } from 'class-transformer';

/**
 * Trim whitespace and uppercase the first letter (rest left untouched).
 * "krypton" -> "Krypton", "  krypton " -> "Krypton".
 */
export function normalizeName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * class-transformer decorator that normalizes a user-entered name-like string.
 * Runs during ValidationPipe transform, before validation (so @IsNotEmpty sees
 * the trimmed value). Applied only to name-like / free-text fields — never to
 * passwords, login usernames, codes, units, stages, UUIDs, dates or numbers.
 */
export const NormalizeName = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeName(value) : value,
  );

/**
 * A registration plate, tidied: `"ab-12-cd"` → `"AB-12-CD"`, `"  AB  12 CD "`
 * → `"AB 12 CD"`.
 *
 * Plates are typed by hand on a phone, so the same trailer arrives as
 * `ab-12-cd` one day and `AB-12-CD` the next. Nothing normalized them before, so
 * both were stored and the trailer looked like two trailers (TRUCK-02). Case is
 * the part that carries no information; the separators are left as typed,
 * because `AB 12 CD` and `AB-12-CD` are the same plate only if the person
 * typing meant them to be — the point here is not to have two spellings of one
 * plate differing by case alone.
 */
export function normalizePlate(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** class-transformer decorator for the plate fields above. */
export const NormalizePlate = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizePlate(value) : value,
  );
