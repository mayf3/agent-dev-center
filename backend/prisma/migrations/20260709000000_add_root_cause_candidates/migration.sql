-- CreateTable: root_cause_candidates
CREATE TABLE "root_cause_candidates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workflow_id" VARCHAR,
    "workflow_name" VARCHAR,
    "root_cause_type" VARCHAR NOT NULL,
    "title" VARCHAR NOT NULL,
    "description" TEXT,
    "severity" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'open',
    "reason_code" VARCHAR,
    "event_type" VARCHAR,
    "affected_requirement_count" INTEGER NOT NULL DEFAULT 0,
    "sample_requirement_ids" JSONB NOT NULL DEFAULT '[]',
    "evidence_event_ids" JSONB NOT NULL DEFAULT '[]',
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "fingerprint" VARCHAR NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "root_cause_candidates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "root_cause_candidates_fingerprint_key" UNIQUE ("fingerprint")
);

-- Create indexes
CREATE INDEX "root_cause_candidates_workflow_id_idx" ON "root_cause_candidates"("workflow_id");
CREATE INDEX "root_cause_candidates_root_cause_type_idx" ON "root_cause_candidates"("root_cause_type");
CREATE INDEX "root_cause_candidates_reason_code_idx" ON "root_cause_candidates"("reason_code");
CREATE INDEX "root_cause_candidates_status_idx" ON "root_cause_candidates"("status");
CREATE INDEX "root_cause_candidates_last_seen_at_idx" ON "root_cause_candidates"("last_seen_at");
