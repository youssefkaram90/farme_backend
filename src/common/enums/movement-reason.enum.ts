/**
 * Why a stock movement happened.
 *
 * Only set on movements a person recorded by hand (referenceType 'manual').
 * Deliveries and sowings leave it null — their cause is already recorded in
 * referenceType, so a reason would just restate it.
 *
 * Shared with agri-input movements in Phase 6, which will add RECEIVED and USED.
 */
export enum MovementReason {
  /** Leftover counted at the start of a season. */
  OPENING = 'opening',
  /** Given or sent back to the client. */
  RETURNED_TO_CLIENT = 'returned_to_client',
  /** Spilled, spoiled, or thrown away. */
  WASTE = 'waste',
  /** Fixing a quantity that was entered wrong. */
  CORRECTION = 'correction',

  /**
   * Agri-inputs only (P6): a delivery of chemicals or fertiliser.
   *
   * Seeds and peat do not use it — they arrive on a delivery, which is already
   * recorded in `referenceType`, so a reason would restate it.
   */
  RECEIVED = 'received',
  /**
   * Agri-inputs only (P6): consumed by a treatment.
   *
   * Always written by the server when an operation is logged, never picked by
   * hand — the same way a sowing writes its own movement against seed stock.
   */
  USED = 'used',
}

/**
 * The label shown for a movement's reason. Delivery and sowing movements carry
 * no reason (their cause is already in `referenceType`), so they show an em dash.
 */
