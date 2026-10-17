-- SOW-10 — drop the dead note column on SowingSSM.
--
-- `SowingSSM` carried two columns for the same idea: `remark` (singular) and
-- `remarks` (plural). A search of the whole backend for `remark:`/`remark =`
-- finds nothing under `src/sowing-ssm/`: the DTO, the create/update paths and the
-- search filter all use `remarks`. The cause is visible in the history — two
-- migrations 17 minutes apart on 2026-09-09 with the SAME name
-- (`20260909171004_add_remark_to_ssm_lpm_sowing` and
-- `20260909173247_add_remark_to_ssm_lpm_sowing`) added one after the other, and
-- the singular was left behind. `SowingLPM` only ever had `remarks`, so the same
-- cleanup had already been done there.
--
-- A column that nobody writes but anybody can read is a trap: a report or a
-- detail page that picks `remark` shows an empty note forever.
--
-- The fold runs FIRST, so dropping the column cannot lose a note that an older
-- build — or a manual edit — may have put there. It only fills an empty
-- `remarks`, so it can never overwrite a note the operator can see today.
UPDATE "SowingSSM"
SET "remarks" = "remark"
WHERE "remarks" IS NULL
  AND "remark" IS NOT NULL;

ALTER TABLE "SowingSSM" DROP COLUMN "remark";
