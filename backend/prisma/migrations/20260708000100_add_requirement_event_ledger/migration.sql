-- CreateTable: requirement_event_ledger
CREATE TABLE "requirement_event_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requirement_id" UUID NOT NULL,
    "event_type" VARCHAR NOT NULL,
    "actor_id" UUID,
    "actor_name" VARCHAR,
    "actor_type" VARCHAR NOT NULL DEFAULT 'system',
    "from_status" VARCHAR,
    "to_status" VARCHAR,
    "from_step" VARCHAR,
    "to_step" VARCHAR,
    "from_assignee_id" UUID,
    "to_assignee_id" UUID,
    "reason_code" VARCHAR,
    "reason_text" TEXT,
    "evidence" JSONB,
    "metadata" JSONB,
    "state_version_before" INTEGER,
    "state_version_after" INTEGER,
    "correlation_id" VARCHAR,
    "source" VARCHAR,
    "source_version" VARCHAR,
    "related_transition_id" UUID,
    "related_report_id" UUID,
    "related_audit_log_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "requirement_event_ledger_pkey" PRIMARY KEY ("id")
);

-- Add foreign key
ALTER TABLE "requirement_event_ledger"
  ADD CONSTRAINT "requirement_event_ledger_requirement_id_fkey"
  FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create indexes
CREATE INDEX "requirement_event_ledger_requirement_id_created_at_idx"
  ON "requirement_event_ledger"("requirement_id", "created_at");
CREATE INDEX "requirement_event_ledger_event_type_created_at_idx"
  ON "requirement_event_ledger"("event_type", "created_at");
CREATE INDEX "requirement_event_ledger_reason_code_created_at_idx"
  ON "requirement_event_ledger"("reason_code", "created_at");
CREATE INDEX "requirement_event_ledger_correlation_id_idx"
  ON "requirement_event_ledger"("correlation_id");
