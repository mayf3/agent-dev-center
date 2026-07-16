-- 9da94ac1: 报告绑定工作流步骤
ALTER TABLE "requirement_reports" ADD COLUMN "workflowStep" TEXT;
CREATE UNIQUE INDEX "requirement_reports_requirementId_reportType_workflowStep_key" ON "requirement_reports"("requirementId", "reportType", "workflowStep");
