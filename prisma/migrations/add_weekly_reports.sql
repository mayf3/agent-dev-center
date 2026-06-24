-- Migration: Add WeeklyReport model
-- Date: 2026-05-21
-- Requirement: f2da8773 - Agent周报系统API未实现

-- Create enum type (if not exists)
DO $$ BEGIN
    CREATE TYPE "WeeklyReportStatus" AS ENUM ('draft', 'submitted', 'reviewed', 'approved', 'changes_requested');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create table
CREATE TABLE IF NOT EXISTS "weekly_reports" (
    "id" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "week" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "nextWeekPlan" TEXT NOT NULL DEFAULT '',
    "blockers" TEXT NOT NULL DEFAULT '',
    "submittedBy" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3),
    "status" "WeeklyReportStatus" NOT NULL DEFAULT 'draft',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "weekly_reports_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "marketplace_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "weekly_reports_agentId_week_key" UNIQUE ("agentId", "week")
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "weekly_reports_agentId_idx" ON "weekly_reports"("agentId");
CREATE INDEX IF NOT EXISTS "weekly_reports_week_idx" ON "weekly_reports"("week");
CREATE INDEX IF NOT EXISTS "weekly_reports_status_idx" ON "weekly_reports"("status");
