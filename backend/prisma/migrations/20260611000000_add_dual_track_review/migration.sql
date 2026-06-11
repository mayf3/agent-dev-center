-- Add efficiency_manager and lobster_partner to InternalRole enum
ALTER TYPE "InternalRole" ADD VALUE 'efficiency_manager';
ALTER TYPE "InternalRole" ADD VALUE 'lobster_partner';

-- Add dual-track review/acceptance verdicts and timestamps to requirements
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "review_verdicts" JSONB DEFAULT '{"efficiency_manager":null,"lobster_partner":null}';
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "acceptance_verdicts" JSONB DEFAULT '{"efficiency_manager":null,"lobster_partner":null}';
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "review_reviewed_at" TIMESTAMP;
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "acceptance_reviewed_at" TIMESTAMP;
