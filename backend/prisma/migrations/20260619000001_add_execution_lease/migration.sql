-- Execution Lease feature: create lease tables for atomic workflow transitions
-- Each ACTIVE lease represents an exclusive execution claim on a requirement
-- Partial unique index ensures at most one ACTIVE lease per requirement

CREATE TYPE "ExecutionLeaseStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'FAILED');

CREATE TABLE "execution_leases" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "workflowStep" TEXT NOT NULL,
    "expectedStateVersion" INTEGER NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "ownerAgentId" TEXT,
    "sessionId" TEXT NOT NULL,
    "claimKey" TEXT NOT NULL,
    "status" "ExecutionLeaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "acquiredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "releasedAt" TIMESTAMPTZ(3),
    "releaseReason" TEXT,
    "worktreePath" TEXT,
    "gitBranch" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "execution_leases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "execution_leases_claimKey_key" UNIQUE ("claimKey")
);

-- Foreign key: requirementId -> requirements(id)
ALTER TABLE "execution_leases"
    ADD CONSTRAINT "execution_leases_requirementId_fkey"
    FOREIGN KEY ("requirementId") REFERENCES "requirements"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign key: ownerUserId -> users(id)
ALTER TABLE "execution_leases"
    ADD CONSTRAINT "execution_leases_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index: at most one ACTIVE lease per requirement
CREATE UNIQUE INDEX "execution_leases_requirementId_active_key"
    ON "execution_leases"("requirementId") WHERE "status" = 'ACTIVE';

CREATE INDEX "execution_leases_requirementId_status_idx"
    ON "execution_leases"("requirementId", "status");

CREATE INDEX "execution_leases_status_expiresAt_idx"
    ON "execution_leases"("status", "expiresAt");

CREATE TABLE "execution_lease_events" (
    "id" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actorId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "execution_lease_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "execution_lease_events_idempotencyKey_key" UNIQUE ("idempotencyKey")
);

CREATE INDEX "execution_lease_events_leaseId_idx" ON "execution_lease_events"("leaseId");
CREATE INDEX "execution_lease_events_createdAt_idx" ON "execution_lease_events"("createdAt");

ALTER TABLE "execution_lease_events"
    ADD CONSTRAINT "execution_lease_events_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "execution_leases"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
