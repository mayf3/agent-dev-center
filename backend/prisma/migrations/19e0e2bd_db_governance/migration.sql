-- Migration: 19e0e2bd DB Schema Governance
-- Phase 1: Add agent fields to users table (additive, non-breaking)
-- Phase 2: (Future) Backfill from marketplace_agents, then drop OKR/Marketplace tables

-- Step 1: Add new columns to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "agent_description" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "agent_capabilities" JSONB DEFAULT '[]';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "agent_api_endpoint" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "agent_token" TEXT UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "openclaw_agent_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "agent_last_heartbeat" TIMESTAMP(3);

-- Step 2: Backfill agent fields from marketplace_agents (safe, idempotent)
UPDATE "users" u SET
    "agent_description" = ma."description",
    "agent_capabilities" = ma."capabilities",
    "agent_api_endpoint" = ma."api_endpoint",
    "agent_token" = ma."agent_token",
    "openclaw_agent_id" = ma."openclaw_agent_id",
    "agent_last_heartbeat" = ma."last_heartbeat_at"
FROM "marketplace_agents" ma
WHERE ma."user_id" = u."id" AND ma."merged_into" IS NULL;

-- Step 3: Create indexes for new columns
CREATE INDEX IF NOT EXISTS "users_agent_token_idx" ON "users"("agent_token");
CREATE INDEX IF NOT EXISTS "users_openclaw_agent_id_idx" ON "users"("openclaw_agent_id");

-- NOTE: Phase 2 (drop OKR tables + marketplace tables) deferred to separate migration
-- after verifying all routes are updated. See docs/migrations/19e0e2bd-db-governance.md
