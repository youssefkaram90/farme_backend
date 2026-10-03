/**
 * Central, user-facing error wording for the whole API.
 *
 * RULE: everything in here is shown verbatim to non-technical users — never
 * include ids, UUIDs, Prisma codes, enum values, camelCase field names or
 * formulas. Both clients (web + phone) render `response.body.message` directly.
 *
 * Domain-specific wording (e.g. "Tunnel T3 only has room for 20 trays") still
 * belongs at the throw site; this file holds the shared/generic wording used by
 * the global exception filter and the guards.
 */
export const ERROR_MESSAGES = {
  /** Truly unexpected failure (unknown exception / unmapped Prisma error). */
  unexpected: 'Something went wrong on our side. Please try again.',

  /** Generic 400 — validation or malformed input. */
  invalidData:
    'Some of the information you entered is not valid. Please check it and try again.',

  /** Foreign-key / referenced record missing (P2003). */
  badReference:
    'A record you selected no longer exists. Please refresh the page and try again.',

  /** P2025 — the record was deleted by someone else in the meantime. */
  alreadyDeleted: 'This record was already deleted.',

  /** 403 — signed in but not allowed to perform the action. */
  notAllowed: "You don't have permission to do this.",

  /** 403 — action reserved for administrators. */
  adminOnly: 'Only an administrator can do this.',

  /** 401 — session invalid or expired. */
  notSignedIn: 'Your session has expired. Please sign in again.',

  /** Credentials rejected on sign-in. */
  invalidCredentials: 'Incorrect name or password.',

  /** 404 — a specific record the user asked for is gone. */
  recordNotFound: 'This record no longer exists.',

  /** 404 — specifically a USER. Says "user", which is what the admin is looking at. */
  userNotFound: 'That user no longer exists.',

  /**
   * 400 — the permission list the admin sent names something that no longer
   * exists (a page left open while permissions were edited elsewhere).
   */
  stalePermissionSelection:
    'One of the selected permissions no longer exists. Reload the page and try again.',

  /** 504 / client-side timeout. */
  timeout: 'The server took too long to respond. Please try again.',

  /** No response at all (network down / server unreachable). */
  offline: 'Cannot reach the server. Please check your connection.',

  /** Fallback for a duplicate we have no specific wording for (P2002). */
  duplicateFallback: 'A record with these details already exists.',
} as const;

/**
 * Friendly wording per unique-constraint field list.
 *
 * Keys match Prisma's `error.meta.target` joined with ' + ', e.g.
 * ['location', 'name'] -> 'location + name'.
 *
 * NOTE: on some Prisma/Postgres combinations `meta.target` is the constraint
 * name instead (e.g. "SowingPlan_name_key"), in which case the fallback is
 * used. Register an explicit `ConflictException` in the service if you need
 * finer wording for a specific case.
 */
const DUPLICATE_BY_MODEL_FIELDS: Record<string, string> = {
  'SowingPlan.location + name':
    'A sowing plan with this name already exists in this location.',
  'SowingPlan.name': 'A sowing plan with this name already exists.',
  'CropCarePlan.name': 'A crop care plan with this name already exists.',
  'Tunnel.number': 'A tunnel with this number already exists.',
  'Sector.location + name':
    'A sector with this name already exists in this location.',
  'User.name': 'A user with this name already exists.',
  'Permission.name': 'A permission with this name already exists.',
  'StockItem.productType + stockType + lotNumber':
    'This lot already exists for that product type and stock type.',
  'SowingTunnelAssignment.ssmSowingId + tunnelId':
    'This tunnel is already assigned to this sowing.',
  'PlantStock.ssmSowingId': 'Plant stock already exists for this sowing.',
  'PlantStock.lpmSowingId': 'Plant stock already exists for this sowing.',
  'PhytosanitaryProduct.name': 'A product with this name already exists.',
  /** Two adds of the same product to one season, arriving together (AGRI-03). */
  'AgriInputSeason.productId': "This product is already in this season's list.",
  'PhytosanitaryProgram.name': 'A program with this name already exists.',
  'PhytosanitaryProgramEntry.programId + inputSeasonId':
    'This product is already in the program.',
  'CropOperation.planEntryId': 'This plan entry already has an operation.',
  'HarvestedProduct.name': 'A harvested product with this name already exists.',
  'HarvestedProduct.name + planteCode':
    'This product already has an entry with that code.',
  'HarvestedProduct.name + planteCode + plantsPerBox':
    'This product already has an entry with that code and box size.',
  'Shipment.shipmentNumber': 'A shipment with this number already exists.',
  'Truck.name': 'A truck with this name already exists.',
};

/** Used to build a readable fallback when nothing more specific is mapped. */
const MODEL_LABELS: Record<string, string> = {
  SowingPlan: 'sowing plan',
  SowingPlanEntry: 'plan entry',
  CropCarePlan: 'crop care plan',
  CropOperation: 'operation',
  Tunnel: 'tunnel',
  Sector: 'sector',
  User: 'user',
  Permission: 'permission',
  StockItem: 'stock lot',
  PlantStock: 'plant stock',
  SowingTunnelAssignment: 'tunnel assignment',
  PhytosanitaryProduct: 'product',
  PhytosanitaryProgram: 'program',
  HarvestedProduct: 'harvested product',
  Shipment: 'shipment',
  Truck: 'truck',
};

/**
 * Resolve a duplicate (P2002) message.
 *
 * @param fields field list of the violated constraint, e.g. 'location + name'
 * @param model  Prisma model name, e.g. 'SowingPlan'
 */
export function duplicateMessage(fields?: string, model?: string): string {
  if (fields && model) {
    // `seasonId` is dropped first. Every season-scoped unique gained it
    // (`@@unique([seasonId, location, name])`), which silently made EVERY key
    // below unreachable and pushed users onto the generic wording. The season is
    // never what the user needs telling about — it is the one they work in.
    const withoutSeason = fields
      .split(' + ')
      .filter((field) => field !== 'seasonId')
      .join(' + ');

    const exact = DUPLICATE_BY_MODEL_FIELDS[`${model}.${withoutSeason}`];
    if (exact) return exact;
  }

  const label = model ? MODEL_LABELS[model] : undefined;
  if (label) {
    return `A ${label} with these details already exists.`;
  }

  return ERROR_MESSAGES.duplicateFallback;
}
