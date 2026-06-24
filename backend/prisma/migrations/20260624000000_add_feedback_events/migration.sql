-- CreateTable
CREATE TABLE IF NOT EXISTS "feedback_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requirementId" UUID NOT NULL,
    "fromStep" TEXT NOT NULL,
    "toStep" TEXT NOT NULL,
    "actorId" UUID,
    "actorName" TEXT,
    "actorRole" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "feedback_events_requirementId_idx" ON "feedback_events"("requirementId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "feedback_events_createdAt_idx" ON "feedback_events"("createdAt");
