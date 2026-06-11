-- Add dual-track reviewer roles.
ALTER TYPE "InternalRole" ADD VALUE IF NOT EXISTS 'efficiency_manager';
ALTER TYPE "InternalRole" ADD VALUE IF NOT EXISTS 'lobster_partner';

-- Store the latest dual-track verdicts on each requirement.
ALTER TABLE "requirements"
ADD COLUMN "reviewVerdicts" JSONB NOT NULL DEFAULT '{"efficiency_manager": null, "lobster_partner": null}'::jsonb;

-- Store review/acceptance comments as first-class requirement comments.
CREATE TABLE "requirement_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requirementId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT,
    "authorId" UUID,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirement_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "requirement_comments_requirementId_idx" ON "requirement_comments"("requirementId");
CREATE INDEX "requirement_comments_type_idx" ON "requirement_comments"("type");
CREATE INDEX "requirement_comments_createdAt_idx" ON "requirement_comments"("createdAt");

ALTER TABLE "requirement_comments"
ADD CONSTRAINT "requirement_comments_requirementId_fkey"
FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
