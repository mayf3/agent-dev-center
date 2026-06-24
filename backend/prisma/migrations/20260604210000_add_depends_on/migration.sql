-- Migration: Add dependsOnIds and blockedBy fields to requirements table
-- Created: 2026-06-04
-- Description: Support requirement dependency tracking

ALTER TABLE "requirements"
  ADD COLUMN "depends_on_ids" TEXT[] DEFAULT '{}',
  ADD COLUMN "blocked_by" TEXT[] DEFAULT '{}';
