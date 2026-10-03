/**
 * The person who caused a write.
 *
 * Both halves are needed, and for different reasons:
 *   - `id` is what a record itself stores (`CropOperation.createdBy`);
 *   - `name` is what a **ledger** stores. A movement has to stay readable on the
 *     screen years later, so it keeps the name as it was at the time rather than
 *     a uuid somebody would have to go and look up.
 *
 * No lookup and no extra query is needed to build one: `request.user` is already
 * a full `User` row, because `JwtStrategy.validate` loads it from the database.
 * A controller therefore just passes it along.
 */
export type Actor = { id: string; name: string };
