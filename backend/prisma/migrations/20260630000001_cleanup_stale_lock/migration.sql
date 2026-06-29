-- Cleanup stale test_env_lock singleton that references a non-existent requirement.
-- The original seed (20260612190001_seed_test_env_lock) used SELECT FROM requirements
-- WHERE currentStep = 'test_env_deploy', which is a no-op on databases with no such
-- requirements.  However, the Fresh DB baseline (bootstrap/baseline.sql) previously
-- used gen_random_uuid() which created a fake owner.  The baseline has since been
-- corrected.  This migration cleans up any stale singleton from the baseline era.
-- Safe criteria: id = 'singleton' AND no matching row in requirements.
-- Real lock rows (requirementId references an existing requirement) are preserved.
DELETE FROM "test_env_lock"
WHERE "id" = 'singleton'
  AND "requirementId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "requirements" WHERE "id" = "test_env_lock"."requirementId");
