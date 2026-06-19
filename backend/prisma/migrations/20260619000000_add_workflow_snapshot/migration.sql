-- Add workflowSnapshot (workflow_snapshot) column to requirements table
-- This stores an immutable deep copy of the workflow template steps
-- at the time of workflow assignment, ensuring template changes don't
-- affect already-assigned requirements.

ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "workflow_snapshot" JSONB;

-- Backfill existing requirements that have a workflowId but no snapshot
-- Only backfill non-terminal-state requirements (currentStep NOT done/abandoned).
-- Rationale:
--   1. Terminal-state requirements are no longer in active flow — they do not need a snapshot.
--   2. The current template may have been hot-updated (the very change that motivated
--      the snapshot feature). Backfilling those stale template steps into terminal-state
--      history would lock potentially problematic data in, using "today's pollution for yesterday".
-- Note: the `status` column is deprecated (all values are 'pending'), so we use
--       `currentStep` to determine terminal state.
UPDATE "requirements" r
SET "workflow_snapshot" = wt."steps"
FROM "workflow_templates" wt
WHERE r."workflowId" IS NOT NULL
  AND r."workflow_snapshot" IS NULL
  AND r."workflowId" = wt."id"
  AND r."currentStep" NOT IN ('done', 'abandoned');
