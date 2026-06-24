-- 8016201d: SSO dedup — add openclawAgentId, registrationSource, registrationGroup, mergedInto
ALTER TABLE marketplace_agents
  ADD COLUMN IF NOT EXISTS "openclawAgentId" TEXT,
  ADD COLUMN IF NOT EXISTS "registrationSource" TEXT,
  ADD COLUMN IF NOT EXISTS "registrationGroup" TEXT,
  ADD COLUMN IF NOT EXISTS "mergedInto" UUID REFERENCES marketplace_agents(id),
  ADD COLUMN IF NOT EXISTS "mergedAt" TIMESTAMP;

-- Set registrationSource for existing agents
UPDATE marketplace_agents SET "registrationSource" = 'sso'
WHERE "ownerId" IN (SELECT id FROM users WHERE email LIKE '%sso.agent.dev%');

UPDATE marketplace_agents SET "registrationSource" = 'seed'
WHERE "registrationSource" IS NULL;

-- Set openclawAgentId for SSO-registered agents (name = agentId)
UPDATE marketplace_agents SET "openclawAgentId" = name
WHERE "registrationSource" = 'sso';

-- Create index for dedup lookups
CREATE INDEX IF NOT EXISTS idx_ma_openclaw_agent_id ON marketplace_agents("openclawAgentId")
WHERE "mergedInto" IS NULL AND "openclawAgentId" IS NOT NULL;
