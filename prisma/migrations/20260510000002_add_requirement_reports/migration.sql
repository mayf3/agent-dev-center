-- CreateEnum: ReportType
CREATE TYPE "ReportType" AS ENUM ('DEV_SELF_CHECK', 'SECURITY_REVIEW', 'TEST_REPORT', 'CTO_REVIEW', 'DEPLOY_CONFIRM');

-- CreateEnum: ReportStatus
CREATE TYPE "ReportStatus" AS ENUM ('pending', 'approved', 'rejected', 'changes_requested');

-- CreateTable: requirement_reports
CREATE TABLE "requirement_reports" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "content" JSONB NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "submittedById" UUID,
    "status" "ReportStatus" NOT NULL DEFAULT 'pending',
    "reviewComment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirement_reports_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "requirement_reports" ADD CONSTRAINT "requirement_reports_requirementId_fkey"
    FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "requirement_reports" ADD CONSTRAINT "requirement_reports_submittedById_fkey"
    FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "requirement_reports_requirementId_idx" ON "requirement_reports"("requirementId");
CREATE INDEX "requirement_reports_reportType_idx" ON "requirement_reports"("reportType");
CREATE INDEX "requirement_reports_submittedBy_idx" ON "requirement_reports"("submittedBy");
CREATE INDEX "requirement_reports_status_idx" ON "requirement_reports"("status");
