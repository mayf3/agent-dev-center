-- Add type enum and tags column to requirements
-- Migration: 20260529_add_type_tags

-- 1. Create RequirementType enum
CREATE TYPE "RequirementType" AS ENUM ('FEATURE', 'BUGFIX', 'POSTMORTEM', 'INFRA', 'SECURITY');

-- 2. Add columns
ALTER TABLE "requirements" ADD COLUMN "type" "RequirementType" NOT NULL DEFAULT 'FEATURE';
ALTER TABLE "requirements" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';

-- 3. Backfill: set type based on title patterns
UPDATE "requirements" SET type = 'POSTMORTEM' WHERE title ILIKE '%[Postmortem]%' OR title ILIKE '%postmortem%' OR title ILIKE '%post-mortem%';
UPDATE "requirements" SET type = 'BUGFIX' WHERE title ILIKE '%[Bugfix]%' OR title ILIKE '%bug%' OR title ILIKE '%修复%' OR title ILIKE '%hotfix%';
UPDATE "requirements" SET type = 'INFRA' WHERE title ILIKE '%[Infra]%' OR title ILIKE '%infra%' OR title ILIKE '%部署%' OR title ILIKE '%docker%' OR title ILIKE '%nginx%';
UPDATE "requirements" SET type = 'SECURITY' WHERE title ILIKE '%[Security]%' OR title ILIKE '%安全%' OR title ILIKE '%security%' OR title ILIKE '%auth%' OR title ILIKE '%鉴权%';

-- 4. Create index on type
CREATE INDEX "requirements_type_idx" ON "requirements"("type");
