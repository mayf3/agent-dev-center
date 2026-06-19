-- Execution Lease feature: add state_version to requirements, create execution_leases and execution_lease_events tables

ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "state_version" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "ExecutionLeaseStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'FAILED');

CREATE TABLE IF NOT EXISTS "execution_leases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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

-- Partial unique index: only one ACTIVE lease per requirement
CREATE UNIQUE INDEX IF NOT EXISTS "execution_leases_requirementId_active_key"
    ON "execution_leases"("requirementId") WHERE "status" = 'ACTIVE';

CREATE INDEX IF NOT EXISTS "execution_leases_requirementId_status_idx"
    ON "execution_leases"("requirementId", "status");

CREATE INDEX IF NOT EXISTS "execution_leases_status_expiresAt_idx"
    ON "execution_leases"("status", "expiresAt");

DO $$ BEGIN
    ALTER TABLE "execution_leases" ADD CONSTRAINT "execution_leases_requirementId_fkey"
        FOREIGN KEY ("requirementId") REFERENCES "requirements"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "execution_leases" ADD CONSTRAINT "execution_leases_ownerUserId_fkey"
        FOREIGN KEY ("ownerUserId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "execution_lease_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "leaseId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actorId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "execution_lease_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "execution_lease_events_idempotencyKey_key" UNIQUE ("idempotencyKey")
);

CREATE INDEX IF NOT EXISTS "execution_lease_events_leaseId_idx" ON "execution_lease_events"("leaseId");
CREATE INDEX IF NOT EXISTS "execution_lease_events_createdAt_idx" ON "execution_lease_events"("createdAt");

DO $$ BEGIN
    ALTER TABLE "execution_lease_events" ADD CONSTRAINT "execution_lease_events_leaseId_fkey"
        FOREIGN KEY ("leaseId") REFERENCES "execution_leases"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
