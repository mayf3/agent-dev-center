-- CreateTable: requirement_revisions

CREATE TABLE "requirement_revisions" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "RequirementPriority" NOT NULL DEFAULT 'P2',
    "status" "RequirementStatus" NOT NULL DEFAULT 'pending',
    "requester" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "assignee" TEXT,
    "dueDate" TIMESTAMP(3),
    "attachment" TEXT,
    "revisionNote" TEXT,
    "operatorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirement_revisions_pkey" PRIMARY KEY ("id")
);

-- Add foreign keys
ALTER TABLE "requirement_revisions" ADD CONSTRAINT "requirement_revisions_requirementId_fkey"
    FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "requirement_revisions" ADD CONSTRAINT "requirement_revisions_operatorId_fkey"
    FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create indexes
CREATE INDEX "requirement_revisions_requirementId_idx" ON "requirement_revisions"("requirementId");
CREATE INDEX "requirement_revisions_createdAt_idx" ON "requirement_revisions"("createdAt");
