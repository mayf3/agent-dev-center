-- AlterTable
ALTER TABLE "requirement_reports"
ADD COLUMN     "qa_bypass" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qa_bypass_reason" TEXT,
ADD COLUMN     "qa_bypass_at" TIMESTAMP(3),
ADD COLUMN     "qa_bypass_by" TEXT;
