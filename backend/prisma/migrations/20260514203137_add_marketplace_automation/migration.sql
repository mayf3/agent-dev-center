-- AlterTable: Add automation fields to marketplace_agents
ALTER TABLE "marketplace_agents" ADD COLUMN "notificationType" TEXT NOT NULL DEFAULT 'polling';
ALTER TABLE "marketplace_agents" ADD COLUMN "feishuWebhookUrl" TEXT;
ALTER TABLE "marketplace_agents" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "marketplace_agents" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);
ALTER TABLE "marketplace_agents" ADD COLUMN "agentToken" TEXT;
CREATE UNIQUE INDEX "marketplace_agents_agentToken_key" ON "marketplace_agents"("agentToken");

-- AlterTable: Add automation fields to marketplace_tasks
ALTER TABLE "marketplace_tasks" ADD COLUMN "notifiedAt" TIMESTAMP(3);
ALTER TABLE "marketplace_tasks" ADD COLUMN "executionTimeMs" INTEGER;
ALTER TABLE "marketplace_tasks" ADD COLUMN "tokensUsed" INTEGER;

-- CreateTable: AgentAccessToken
CREATE TABLE "agent_access_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agentId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "agent_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_access_tokens_token_key" ON "agent_access_tokens"("token");
CREATE INDEX "agent_access_tokens_agentId_idx" ON "agent_access_tokens"("agentId");
CREATE INDEX "agent_access_tokens_token_idx" ON "agent_access_tokens"("token");

-- AddForeignKey
ALTER TABLE "agent_access_tokens" ADD CONSTRAINT "agent_access_tokens_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "marketplace_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
