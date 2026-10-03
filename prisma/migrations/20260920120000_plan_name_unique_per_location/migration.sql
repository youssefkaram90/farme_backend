-- A plan name may now be reused across locations (LPM: the same "sector" —
-- e.g. "Sector 1" — can exist in several locations). Uniqueness therefore
-- moves from `name` alone to `(location, name)`.

-- 1. Backfill NULL locations first: the column is about to become NOT NULL and
--    take part in the composite unique index (Postgres treats NULLs as
--    distinct, which would silently allow duplicate SSM plan names).
UPDATE "SowingPlan" SET "location" = '' WHERE "location" IS NULL;

-- 2. Drop the old global unique index on `name`.
DROP INDEX IF EXISTS "SowingPlan_name_key";

-- 3. Make `location` non-nullable, defaulting to '' for plans without one.
ALTER TABLE "SowingPlan" ALTER COLUMN "location" SET DEFAULT '';
ALTER TABLE "SowingPlan" ALTER COLUMN "location" SET NOT NULL;

-- 4. New composite unique index: name unique per location.
CREATE UNIQUE INDEX "SowingPlan_location_name_key" ON "SowingPlan"("location", "name");
