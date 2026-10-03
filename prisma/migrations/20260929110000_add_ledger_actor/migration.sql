/*
  Who caused each ledger movement — stored as the user's NAME, and required.

  The actor is a copy, not a reference: a ledger has to stay readable years later,
  so it keeps the name as it was written rather than a uuid that would have to be
  looked up (and the screen wants a word, not an id). A later rename therefore
  cannot rewrite what the record says about who did it.

  Three tables, and they need different treatment because they start in different
  states:

    - `AgriInputMovement` already had a `createdBy` holding a user id. Added the
      same day, never read by any client, so it is RENAMED and its ids resolved to
      names through `User`.
    - `StockMovement` and `HarvestStockMovement` had no actor at all.

  All three end up NOT NULL, so every backfill below runs BEFORE its constraint.
  The backfill only ever touches rows that already existed; nothing created from
  now on can be written without a name, because Prisma requires the field.
*/

-- AgriInputMovement: id -> name, resolved through User where we still can.
ALTER TABLE "AgriInputMovement" RENAME COLUMN "createdBy" TO "createdByName";

UPDATE "AgriInputMovement" AS m
SET "createdByName" = COALESCE(
  (SELECT u."name" FROM "User" AS u WHERE u."id" = m."createdByName"),
  'Unknown'
);

ALTER TABLE "AgriInputMovement" ALTER COLUMN "createdByName" SET NOT NULL;

-- StockMovement: never had an actor, so its past can only be labelled honestly.
ALTER TABLE "StockMovement" ADD COLUMN "createdByName" TEXT;

UPDATE "StockMovement" SET "createdByName" = 'Unknown' WHERE "createdByName" IS NULL;

ALTER TABLE "StockMovement" ALTER COLUMN "createdByName" SET NOT NULL;

-- HarvestStockMovement: the same.
ALTER TABLE "HarvestStockMovement" ADD COLUMN "createdByName" TEXT;

UPDATE "HarvestStockMovement" SET "createdByName" = 'Unknown' WHERE "createdByName" IS NULL;

ALTER TABLE "HarvestStockMovement" ALTER COLUMN "createdByName" SET NOT NULL;
