-- AlterTable: add workflow fields to requirements
ALTER TABLE "requirements" ADD COLUMN "workflowId" UUID;
ALTER TABLE "requirements" ADD COLUMN "currentStep" TEXT;

-- CreateTable: workflow_templates
CREATE TABLE "workflow_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable: workflow_transitions
CREATE TABLE "workflow_transitions" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "fromStep" TEXT NOT NULL,
    "toStep" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" UUID,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "comment" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_templates_name_key" ON "workflow_templates"("name");
CREATE INDEX "workflow_templates_isActive_idx" ON "workflow_templates"("isActive");
CREATE INDEX "workflow_transitions_requirementId_idx" ON "workflow_transitions"("requirementId");
CREATE INDEX "workflow_transitions_fromStep_idx" ON "workflow_transitions"("fromStep");
CREATE INDEX "workflow_transitions_createdAt_idx" ON "workflow_transitions"("createdAt");

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed workflow templates
INSERT INTO "workflow_templates" ("id", "name", "displayName", "description", "steps", "isActive") VALUES
(
  gen_random_uuid(),
  'backend-dev',
  '后端开发',
  '标准后端开发流程：开发自检 → 测试 → CTO审核 → 部署 → 完成',
  '[{"name":"dev_self_check","displayName":"开发自检","role":"developer","requiredReports":["DEV_SELF_CHECK"],"autoAdvance":false},{"name":"test","displayName":"测试验证","role":"tester","requiredReports":["TEST_REPORT"],"autoAdvance":false},{"name":"cto_review","displayName":"CTO审核","role":"cto","requiredReports":["CTO_REVIEW"],"autoAdvance":false},{"name":"deploy","displayName":"部署上线","role":"ops","requiredReports":["DEPLOY_CONFIRM"],"autoAdvance":false},{"name":"done","displayName":"完成","role":"auto","requiredReports":[],"autoAdvance":true}]'::jsonb,
  true
),
(
  gen_random_uuid(),
  'frontend-dev',
  '前端开发',
  '标准前端开发流程：开发自检 → 测试 → CTO审核 → 部署 → 完成',
  '[{"name":"dev_self_check","displayName":"开发自检","role":"developer","requiredReports":["DEV_SELF_CHECK"],"autoAdvance":false},{"name":"test","displayName":"测试验证","role":"tester","requiredReports":["TEST_REPORT"],"autoAdvance":false},{"name":"cto_review","displayName":"CTO审核","role":"cto","requiredReports":["CTO_REVIEW"],"autoAdvance":false},{"name":"deploy","displayName":"部署上线","role":"ops","requiredReports":["DEPLOY_CONFIRM"],"autoAdvance":false},{"name":"done","displayName":"完成","role":"auto","requiredReports":[],"autoAdvance":true}]'::jsonb,
  true
),
(
  gen_random_uuid(),
  'ops-deploy',
  '运维部署',
  '运维部署流程：部署 → 验证 → 完成',
  '[{"name":"deploy","displayName":"部署执行","role":"ops","requiredReports":["DEPLOY_CONFIRM"],"autoAdvance":false},{"name":"verify","displayName":"部署验证","role":"tester","requiredReports":["TEST_REPORT"],"autoAdvance":false},{"name":"done","displayName":"完成","role":"auto","requiredReports":[],"autoAdvance":true}]'::jsonb,
  true
),
(
  gen_random_uuid(),
  'hotfix',
  '紧急修复',
  '紧急修复流程：开发自检 → 部署 → 完成（跳过测试和CTO审核）',
  '[{"name":"dev_self_check","displayName":"开发自检","role":"developer","requiredReports":["DEV_SELF_CHECK"],"autoAdvance":false},{"name":"deploy","displayName":"紧急部署","role":"ops","requiredReports":["DEPLOY_CONFIRM"],"autoAdvance":false},{"name":"done","displayName":"完成","role":"auto","requiredReports":[],"autoAdvance":true}]'::jsonb,
  true
);
