-- Add userId field to marketplace_agents for direct user lookup
-- Migration: 20260530_add_agent_user_id

-- 1. Add userId column
ALTER TABLE "marketplace_agents" ADD COLUMN IF NOT EXISTS "user_id" UUID UNIQUE;

-- 2. Create index
CREATE INDEX IF NOT EXISTS "marketplace_agents_userId_idx" ON "marketplace_agents"("user_id");

-- 3. Backfill: set userId = ownerId where ownerId points to a real user
UPDATE "marketplace_agents" SET "user_id" = "ownerId" WHERE "ownerId" IS NOT NULL;

-- 4. For agents that don't have a matching user, create users and link them
-- This handles the seed agents (all owned by CTO) — skip auto-creation for safety
-- The SSO registration flow will handle new agent creation going forward
