-- 2026-06-14 Schema Sync Migration
-- 安全增量升级：只 ADD，不 DROP（branchName 除外，已确认无用）
-- 目的：让数据库 schema 与 schema.prisma 一致，解决新镜像启动 500 的问题

-- ═══════════════════════════════════════════════════
-- 1. InternalRole enum 扩展（developer 拆分为细粒度角色）
-- ═══════════════════════════════════════════════════

-- 先迁移现有 developer 数据到 backend_developer
UPDATE "users" SET "internal_role" = 'backend_developer' WHERE "internal_role" = 'developer';

-- 安全替换 enum（PostgreSQL 不支持 ALTER TYPE ADD VALUE 后直接用，需要重建类型）
BEGIN;
CREATE TYPE "InternalRole_new" AS ENUM (
  'cto', 'pm',
  'backend_developer', 'frontend_developer', 'mobile_developer',
  'miniapp_developer', 'game_developer',
  'tester', 'security', 'ops', 'qa', 'architect'
);
ALTER TABLE "users" ALTER COLUMN "internal_role" TYPE "InternalRole_new"
  USING ("internal_role"::text)::"InternalRole_new";
ALTER TYPE "InternalRole" RENAME TO "InternalRole_old";
ALTER TYPE "InternalRole_new" RENAME TO "InternalRole";
DROP TYPE "InternalRole_old";
COMMIT;

-- ═══════════════════════════════════════════════════
-- 2. ReportType enum 增加（ARCH_DESIGN, ARCH_REVIEW, MERGE_REPORT）
-- ═══════════════════════════════════════════════════

ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'ARCH_DESIGN';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'ARCH_REVIEW';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'MERGE_REPORT';

-- ═══════════════════════════════════════════════════
-- 3. RequirementStatus enum 增加（draft, abandoned）
-- ═══════════════════════════════════════════════════

ALTER TYPE "RequirementStatus" ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE "RequirementStatus" ADD VALUE IF NOT EXISTS 'abandoned';

-- ═══════════════════════════════════════════════════
-- 4. requirements 表：增加缺失列，删除废弃列
-- ═══════════════════════════════════════════════════

ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "repoPath" TEXT;
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "branch" TEXT;
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "projectId" UUID;
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "deployVersion" TEXT;

-- branchName 已从 schema 中移除，如果存在则删除
ALTER TABLE "requirements" DROP COLUMN IF EXISTS "branchName";

-- 索引
CREATE INDEX IF NOT EXISTS "requirements_projectId_idx" ON "requirements"("projectId");

-- 外键
DO $$ BEGIN
  ALTER TABLE "requirements" ADD CONSTRAINT "requirements_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════
-- 5. requirement_reports 表：workflow_step + unique index
-- ═══════════════════════════════════════════════════

ALTER TABLE "requirement_reports" ADD COLUMN IF NOT EXISTS "workflowStep" TEXT;

DO $$ BEGIN
  CREATE UNIQUE INDEX "requirement_reports_requirementId_reportType_workflowStep_key"
    ON "requirement_reports"("requirementId", "reportType", "workflowStep");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════
-- 6. test_env_lock 表
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "test_env_lock" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "requirementId" UUID NOT NULL,
    "requirementTitle" TEXT,
    "branch" TEXT,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "test_env_lock_pkey" PRIMARY KEY ("id")
);

-- ═══════════════════════════════════════════════════
-- 7. workflow_templates 表（如果不存在则创建）
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "workflow_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workflow_templates_name_key" UNIQUE ("name")
);
CREATE INDEX IF NOT EXISTS "workflow_templates_isActive_idx" ON "workflow_templates"("isActive");

-- ═══════════════════════════════════════════════════
-- 8. workflow_transitions 表
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "workflow_transitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requirementId" UUID NOT NULL,
    "fromStep" TEXT NOT NULL,
    "toStep" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" UUID,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "comment" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "workflow_transitions_requirementId_idx" ON "workflow_transitions"("requirementId");
CREATE INDEX IF NOT EXISTS "workflow_transitions_fromStep_idx" ON "workflow_transitions"("fromStep");
CREATE INDEX IF NOT EXISTS "workflow_transitions_createdAt_idx" ON "workflow_transitions"("createdAt");

-- 外键（注意：requirements 表可能有不能 CASCADE 删除的历史数据）
DO $$ BEGIN
  ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_requirementId_fkey"
    FOREIGN KEY ("requirementId") REFERENCES "requirements"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════
-- 9. daily_logs 表
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "daily_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agentId" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'working',
    "content" TEXT NOT NULL,
    "problems" TEXT,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "daily_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "daily_logs_agentId_date_key" ON "daily_logs"("agentId", "date");
CREATE INDEX IF NOT EXISTS "daily_logs_date_idx" ON "daily_logs"("date");
CREATE INDEX IF NOT EXISTS "daily_logs_agentId_idx" ON "daily_logs"("agentId");

-- ═══════════════════════════════════════════════════
-- 10. requirement_comments 表
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "requirement_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requirementId" UUID NOT NULL,
    "parentId" UUID,
    "content" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'discussion',
    "status" TEXT NOT NULL DEFAULT 'open',
    "mentions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "requirement_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "requirement_comments_requirementId_idx" ON "requirement_comments"("requirementId");
CREATE INDEX IF NOT EXISTS "requirement_comments_authorId_idx" ON "requirement_comments"("authorId");
CREATE INDEX IF NOT EXISTS "requirement_comments_parentId_idx" ON "requirement_comments"("parentId");
CREATE INDEX IF NOT EXISTS "requirement_comments_status_idx" ON "requirement_comments"("status");

-- ═══════════════════════════════════════════════════
-- 11. users 表缺失列
-- ═══════════════════════════════════════════════════

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "okr_role" TEXT NOT NULL DEFAULT 'okr_member';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" TIMESTAMPTZ(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMPTZ(3);
CREATE INDEX IF NOT EXISTS "users_lastLoginAt_idx" ON "users"("lastLoginAt");

-- ═══════════════════════════════════════════════════
-- 12. requirements 表其他缺失列
-- ═══════════════════════════════════════════════════

ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'FEATURE';
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "gitHash" TEXT;
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "currentStep" TEXT;
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "workflowId" UUID;
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "depends_on_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "blocked_by" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "pm_approved_at" TIMESTAMPTZ(3);
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "pm_approved_by" TEXT;
ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "notes" TEXT;

CREATE INDEX IF NOT EXISTS "requirements_currentStep_idx" ON "requirements"("currentStep");
CREATE INDEX IF NOT EXISTS "requirements_priority_idx" ON "requirements"("priority");
CREATE INDEX IF NOT EXISTS "requirements_type_idx" ON "requirements"("type");
CREATE INDEX IF NOT EXISTS "requirements_requesterId_idx" ON "requirements"("requesterId");
CREATE INDEX IF NOT EXISTS "requirements_assigneeId_idx" ON "requirements"("assigneeId");

-- ═══════════════════════════════════════════════════
-- 验证
-- ═══════════════════════════════════════════════════
-- 执行后检查：
-- SELECT unnest(enum_range(NULL::"InternalRole"));  -- 应有 12 个值
-- SELECT unnest(enum_range(NULL::"ReportType"));     -- 应有 10 个值
-- SELECT count(*) FROM information_schema.columns WHERE table_name = 'requirements'; -- 对比 schema
