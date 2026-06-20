-- Add workflowSnapshot and stateVersion to requirements table
-- workflowSnapshot: immutable deep copy of workflow template steps at assign time
-- stateVersion: optimistic concurrency counter for CAS workflow transitions

ALTER TABLE "requirements" ADD COLUMN "workflow_snapshot" JSONB;
ALTER TABLE "requirements" ADD COLUMN "state_version" INTEGER NOT NULL DEFAULT 0;

-- Backfill workflowSnapshot for all requirements that:
--  * have a non-null workflowId
--  * currently have no workflow_snapshot
--  * match a workflow_templates row
--  * the template's steps column holds a supported JSON structure
--
-- Supported structures:
--   Structure A: direct JSON array — jsonb_typeof(steps) = 'array'
--   Structure B: JSON object with a "steps" array — jsonb_typeof(steps) = 'object'
--                                                 AND jsonb_typeof(steps -> 'steps') = 'array'
--     Optional "roleUserMap": if present it must be a JSON object or JSON null.
--     String, number, boolean, or array roleUserMap values are rejected.
--
-- Requirements without a valid structure keep workflowSnapshot NULL
-- and fall through to the legacy workflow.steps resolution.

UPDATE "requirements" r
SET "workflow_snapshot" = wt."steps"
FROM "workflow_templates" wt
WHERE r."workflowId" IS NOT NULL
  AND r."workflow_snapshot" IS NULL
  AND r."workflowId" = wt."id"
  AND (
    jsonb_typeof(wt."steps") = 'array'
    OR
    (
      jsonb_typeof(wt."steps") = 'object'
      AND jsonb_typeof(wt."steps" -> 'steps') = 'array'
      AND (
        (wt."steps" ? 'roleUserMap') = false
        OR jsonb_typeof(wt."steps" -> 'roleUserMap') = 'object'
        OR jsonb_typeof(wt."steps" -> 'roleUserMap') = 'null'
      )
    )
  );
