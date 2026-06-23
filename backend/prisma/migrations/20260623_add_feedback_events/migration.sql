-- CreateTable
CREATE TABLE "feedback_events" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "fromStep" TEXT NOT NULL,
    "toStep" TEXT NOT NULL,
    "actorId" UUID,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feedback_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_events_requirementId_idx" ON "feedback_events"("requirementId");
CREATE INDEX "feedback_events_fromStep_idx" ON "feedback_events"("fromStep");
CREATE INDEX "feedback_events_createdAt_idx" ON "feedback_events"("createdAt");
CREATE INDEX "feedback_events_actorId_idx" ON "feedback_events"("actorId");

-- AddForeignKey
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
