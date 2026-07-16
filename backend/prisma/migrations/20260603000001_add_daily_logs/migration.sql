-- CreateTable: DailyLog
CREATE TABLE "daily_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agentId" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'working',
    "content" TEXT NOT NULL,
    "problems" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_logs_pkey" PRIMARY KEY ("id")
);

-- Unique: one log per agent per day
CREATE UNIQUE INDEX "daily_logs_agentId_date_key" ON "daily_logs"("agentId", "date");

-- Indexes
CREATE INDEX "daily_logs_date_idx" ON "daily_logs"("date");
CREATE INDEX "daily_logs_agentId_idx" ON "daily_logs"("agentId");
CREATE INDEX "daily_logs_submittedAt_idx" ON "daily_logs"("submittedAt");

-- FK
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "marketplace_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
