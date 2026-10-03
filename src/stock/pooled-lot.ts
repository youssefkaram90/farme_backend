/**
 * The stock pool a delivered lot's quantity belongs to.
 *
 * Seeds and peat are pooled differently, and the difference used to be written
 * out by hand in four places in `deliveries.service.ts` and four more in
 * `sowing-ssm.service.ts` (DELIV-06) — the kind of duplication where one copy
 * gets edited and "all peat is one pool" quietly becomes two.
 *
 * **Peat is deliberately ONE pool.** Every peat delivery, whatever lot number or
 * stock type it arrives with, adds to the same stock row, because peat is not
 * tracked by lot — it is one pile that gets used up.
 *
 * Its stock type is `'GENERIC'`, which is **not** a `StockType` (`BIO`/`CVT`):
 * there is no such thing as peat of a variety. The delivery form used to demand a
 * BIO/CVT value for every lot and then ignore it for peat, which is how a value
 * outside the enum ended up in the ledger (DELIV-04).
 */

/** Every peat delivery lands in this lot number. */
export const PEAT_LOT_NUMBER = 'PEAT';

/** The stock type peat is stored under — not a `StockType`, on purpose. */
export const PEAT_STOCK_TYPE = 'GENERIC';

/** The peat pool's key, for callers that only ever move peat. */
export const PEAT_POOL = {
  lotNumber: PEAT_LOT_NUMBER,
  stockType: PEAT_STOCK_TYPE,
};

/** The pool key for one lot: its own, unless it is peat. */
export function pooledLot(lot: {
  productType: string;
  lotNumber: string;
  stockType: string;
}): { lotNumber: string; stockType: string } {
  return lot.productType === 'PEAT' ? PEAT_POOL : { ...lot };
}
