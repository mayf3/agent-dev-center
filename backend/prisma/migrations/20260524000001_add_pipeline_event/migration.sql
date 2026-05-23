-- CreatePipelineEventTable
CREATE TABLE "pipeline_events" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "taskId" UUID NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorId" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX "pipeline_events_taskId_idx" ON "pipeline_events"("taskId");
CREATE INDEX "pipeline_events_toStatus_actor_idx" ON "pipeline_events"("toStatus", "actor");
