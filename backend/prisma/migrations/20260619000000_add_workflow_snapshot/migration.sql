-- Add workflowSnapshot (workflow_snapshot) column to requirements table
-- This stores an immutable deep copy of the workflow template steps
-- at the time of workflow assignment, ensuring template changes don't
-- affect already-assigned requirements.

ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "workflow_snapshot" JSONB;

-- Backfill existing requirements that have a workflowId but no snapshot
-- Copy the template's steps (preserving both array and {steps, roleUserMap} formats)
UPDATE "requirements" r
SET "workflow_snapshot" = wt."steps"
FROM "workflow_templates" wt
WHERE r."workflowId" IS NOT NULL
  AND r."workflow_snapshot" IS NULL
  AND r."workflowId" = wt."id";
