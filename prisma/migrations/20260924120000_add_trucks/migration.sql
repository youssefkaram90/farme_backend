-- Trucks become real records: the name is unique (so a typo cannot create a
-- second "Truck 1") and one truck can carry many shipments.
CREATE TABLE "Truck" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trailerPlateNumber" TEXT NOT NULL,
    "truckPlateNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Truck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Truck_name_key" ON "Truck"("name");

-- One Truck row per distinct truck name already used, so no existing shipment
-- loses its truck. The plates were not recorded on shipments, so backfilled
-- rows start with an empty trailer plate and must be filled in by hand.
-- (gen_random_uuid() is core in PostgreSQL 13+.)
INSERT INTO "Truck" ("id", "name", "trailerPlateNumber", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "truck", '', NOW(), NOW()
FROM "Shipment"
GROUP BY "truck";

ALTER TABLE "Shipment" ADD COLUMN "truckId" TEXT;

UPDATE "Shipment" s
SET "truckId" = t."id"
FROM "Truck" t
WHERE t."name" = s."truck";

ALTER TABLE "Shipment" ALTER COLUMN "truckId" SET NOT NULL;

ALTER TABLE "Shipment" DROP COLUMN "truck";

-- Restrict, not cascade: deleting a truck that still holds shipments is refused.
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_truckId_fkey"
    FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Shipment_truckId_idx" ON "Shipment"("truckId");

-- A unique shipment number. The plain index it replaces is redundant, so it goes.
-- If this fails, there are existing duplicate numbers to resolve first.
DROP INDEX "Shipment_shipmentNumber_idx";
CREATE UNIQUE INDEX "Shipment_shipmentNumber_key" ON "Shipment"("shipmentNumber");
