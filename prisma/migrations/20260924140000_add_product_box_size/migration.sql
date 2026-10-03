-- Box size becomes part of the finished-goods product's identity.
--
-- Why: a shipment had to be TOLD the plants per box, but that number was never
-- stored on the thing being shipped. It lives on the harvest record, and one
-- product merges many harvest records (keyed on name + planteCode). The same
-- variety and code packed at 410 and at 430 are physically different boxes, so
-- they must not share a stock pool. Splitting the pool makes the number
-- unambiguous, which is what lets the shipment form show it instead of asking
-- for it.

ALTER TABLE "HarvestedProduct" ADD COLUMN "plantsPerBox" INTEGER;

-- Backfill from the harvest records that fed each product.
--
-- A pool that was ALREADY mixed keeps its combined quantity and takes its newest
-- harvest's box size — the quantity cannot be re-split without a box size on every
-- historical movement. Only new harvests split properly.
--
-- This cannot create a duplicate, because (name, planteCode) was unique until
-- now, so (name, planteCode, plantsPerBox) necessarily is too.
UPDATE "HarvestedProduct" p
SET "plantsPerBox" = COALESCE(
  (
    SELECT r."plantsPerBox"
    FROM "HarvestRecord" r
    WHERE r."productName" = p."name"
      AND r."planteCode" = p."planteCode"
    ORDER BY r."harvestedAt" DESC
    LIMIT 1
  ),
  0
);

ALTER TABLE "HarvestedProduct" ALTER COLUMN "plantsPerBox" SET NOT NULL;

-- Replace (name, planteCode) uniqueness with (name, planteCode, plantsPerBox).
DROP INDEX "HarvestedProduct_name_planteCode_key";
CREATE UNIQUE INDEX "HarvestedProduct_name_planteCode_plantsPerBox_key"
  ON "HarvestedProduct"("name", "planteCode", "plantsPerBox");
