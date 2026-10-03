/**
 * The plant code printed on the box label.
 *
 * It is the ONLY way to tell two batches of the same variety apart once they
 * reach the finished-goods store — "Krypton 12" and "Krypton 13" are different
 * boxes of the same variety, and merging them would make the stock figure
 * meaningless.
 *
 *   SSM (tunnel) — the sowing's batch code, e.g. "12"
 *   LPM (sector) — box size in hundreds plus the sector, e.g. "12 Ha4-1",
 *                  because the box size on its own is not unique to a batch.
 *
 * Derived server-side so both clients and every entry route agree; the clients
 * only display it.
 */
export function derivePlanteCode(
  batch: { code: number | null; lotNumber: string; location: string },
  plantsPerBox: number,
  targetType: 'TUNNEL' | 'SECTOR',
): string {
  if (targetType === 'TUNNEL') {
    // SowingSSM.code is required, so this is the normal path. The lot number is
    // only a safety net: an EMPTY code would merge unrelated batches into one
    // stock row, which is worse than a slightly different label.
    return batch.code != null ? String(batch.code) : batch.lotNumber;
  }

  return `${plantsPerBox / 100} ${batch.location}`.trim();
}
