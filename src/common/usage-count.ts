/**
 * Plain-language counting, for the "this cannot be deleted" messages.
 *
 * Kept in one place because the tunnels and the sectors guards say the same
 * kind of sentence, and the same sentence is read on the web and on the phone —
 * it must not be written twice and drift apart (X-11).
 */

/**
 * `counted(4, 'sowing', 'sowings')` → `"4 sowings"`.
 *
 * Returns `undefined` for 0/null/undefined, so a caller can list only what is
 * actually there and get an empty list when nothing is.
 */
export function counted(
  count: number | undefined | null,
  one: string,
  many: string,
): string | undefined {
  if (!count || count <= 0) return undefined;
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * `["4 sowings", "1 transport"]` → `"4 sowings and 1 transport"`.
 *
 * `undefined` entries are dropped (that is what `counted` returns for a zero
 * count), and an empty list comes back as `""` so the caller can test it.
 */
export function countedList(entries: (string | undefined)[]): string {
  const parts = entries.filter((entry): entry is string => entry !== undefined);

  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];

  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
