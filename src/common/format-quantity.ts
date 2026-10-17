/**
 * How a stock quantity is written, for the one place the API formats one: the
 * close-season report's list of balances that are still not zero.
 *
 * The clients have the same module (`Frontend/app/lib/format-quantity.ts`,
 * `Phone-App/src/lib/format-quantity.ts`). It lives here too rather than being
 * written inline because this report is read by a person: the rule for `PEAT`
 * versus everything else should not be a second opinion.
 *
 * **The rule:** seeds and everything else are COUNTS (`12,500`); peat is a bulk
 * figure (`125.50`).
 */

/** Peat is a bulk quantity: this many decimals, fixed. */
export const PEAT_DECIMALS = 2;

export function formatQuantity(value: number, productType: string): string {
  return productType === 'PEAT'
    ? value.toFixed(PEAT_DECIMALS)
    : value.toLocaleString('en-GB');
}
