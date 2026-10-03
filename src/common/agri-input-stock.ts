/**
 * What is left of an agri-input, said the way a person would say it.
 *
 * Shared by the two places a shortage can happen — the manual adjustment
 * (`AgriInputsService.adjustStock`) and the deduction a logged treatment makes
 * (`CropCareService.consumeAgriInput`) — so the same shortage cannot end up
 * reading two different ways depending on which screen hit it.
 *
 * ⚠️ Seeds and peat still build this sentence in `StockService.adjustStock`.
 * It is the same idea and could adopt this helper later; left alone for now
 * because that wording is already verified with the user.
 */
export function notEnoughAgriInput(params: {
  name: string;
  unit?: string | null;
  left: number;
  seasonCode: string;
}): string {
  const { name, unit, left, seasonCode } = params;

  // "Only 0 KG of Copper is left" is technically true and reads terribly —
  // the nothing-left case gets its own sentence.
  if (left <= 0) {
    return `There is none of ${name} left in season ${seasonCode}.`;
  }

  const amount = `${left.toLocaleString('en-GB')}${unit ? ` ${unit}` : ''}`;
  return `Only ${amount} of ${name} is left in season ${seasonCode}.`;
}
