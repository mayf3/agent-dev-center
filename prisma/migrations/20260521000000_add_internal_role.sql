-- Add InternalRole enum and internal_role column to users
CREATE TYPE "InternalRole" AS ENUM ('cto', 'pm', 'developer', 'tester', 'security', 'ops', 'qa');

ALTER TABLE "users" ADD COLUMN "internal_role" "InternalRole";

-- Set internal roles for known users
UPDATE "users" SET "internal_role" = 'cto' WHERE "email" IN ('admin@example.com', 'cto@example.com');
UPDATE "users" SET "internal_role" = 'developer' WHERE "email" = 'agent-dev-engineer@example.com';
UPDATE "users" SET "internal_role" = 'developer' WHERE "email" = 'frontend@example.com';

-- Add PM approval fields to requirements
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "pm_approved_at" TIMESTAMP;
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "pm_approved_by" TEXT;

-- Add QA review fields to reports
ALTER TABLE "requirement_reports" ADD COLUMN IF NOT EXISTS "qa_reviewed_at" TIMESTAMP;
ALTER TABLE "requirement_reports" ADD COLUMN IF NOT EXISTS "qa_reviewed_by" TEXT;
