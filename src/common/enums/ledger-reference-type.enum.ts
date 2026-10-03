/**
 * The reference types of the two ledgers that are NOT `StockMovement`.
 *
 * The schema has three movement tables and they do **not** share a vocabulary:
 *
 * | table                    | what it holds            | values                                    | enum lives |
 * | ------------------------ | ------------------------ | ----------------------------------------- | ---------- |
 * | `StockMovement`          | seeds and peat           | `delivery` \| `sowing` \| `manual`        | `stock/enums/reference-type.enum.ts` |
 * | `HarvestStockMovement`   | harvested product        | `harvest` \| `shipment` \| `writeoff`     | `HarvestReferenceType` below |
 * | `AgriInputMovement`      | crop care and fertiliser | `operation` (nullable column)             | `AgriInputReferenceType` below |
 *
 * They are separate enums rather than one list on purpose: the columns are plain
 * `String` in the schema, so **TypeScript is the only check there is** — one
 * shared list would let `'shipment'` be written onto a seed movement and nothing
 * anywhere would notice (STOCK-03).
 */

/** `HarvestStockMovement.referenceType` — see `schema.prisma`. */
export enum HarvestReferenceType {
  /** Positive: a harvest came in. */
  HARVEST = 'harvest',
  /** Negative: a shipment took boxes out. */
  SHIPMENT = 'shipment',
  /** Negative: stock written off. */
  WRITEOFF = 'writeoff',
}

/**
 * `AgriInputMovement.referenceType` — the column is nullable, so most writes
 * leave it unset; only a treatment points at something.
 */
export enum AgriInputReferenceType {
  /** A treatment consumed the product; `referenceId` is the operation's id. */
  OPERATION = 'operation',
  /**
   * Somebody typed this line in by hand: an opening balance, a delivery that
   * arrived, a return, a write-off or a correction.
   *
   * Added with AGRI-04. This ledger left the column null for manual lines while
   * the seeds-and-peat ledger wrote `manual` for them, so "was this counted, or
   * typed?" had an answer in one ledger and not in the other.
   */
  MANUAL = 'manual',
}
