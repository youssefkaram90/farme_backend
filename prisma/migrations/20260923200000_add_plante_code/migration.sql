-- The plant code printed on the box label. It is the finished-goods store's only
-- way to tell two batches of the same variety apart ("Krypton 12" vs "Krypton
-- 13"), so both the harvest record and the product row must carry it.
--
-- Added with an empty default (existing rows need a value) and then the default
-- is dropped so the column matches the schema exactly.
--
-- Backfilling '' is deliberate: every pre-existing harvest and product gets the
-- same empty code, so an old harvest still pairs with the old product row and
-- deleting it still reverses the right stock.
ALTER TABLE "HarvestRecord" ADD COLUMN "planteCode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HarvestRecord" ALTER COLUMN "planteCode" DROP DEFAULT;

ALTER TABLE "HarvestedProduct" ADD COLUMN "planteCode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HarvestedProduct" ALTER COLUMN "planteCode" DROP DEFAULT;

-- Replace name-only uniqueness with (name, planteCode).
-- Existing rows all carry planteCode = '', which remains unique per name, so
-- creating this index cannot collide.
DROP INDEX "HarvestedProduct_name_key";
CREATE UNIQUE INDEX "HarvestedProduct_name_planteCode_key" ON "HarvestedProduct"("name", "planteCode");
