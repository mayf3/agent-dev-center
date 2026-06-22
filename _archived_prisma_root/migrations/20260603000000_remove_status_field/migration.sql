-- DropRequirementStatusColumn
ALTER TABLE "requirements" DROP COLUMN IF EXISTS "status";
CREATE INDEX IF NOT EXISTS "requirements_current_step_idx" ON "requirements"("currentStep");
