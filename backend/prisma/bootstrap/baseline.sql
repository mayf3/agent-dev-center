-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'requester', 'developer', 'agent', 'cto_agent');

-- CreateEnum
CREATE TYPE "InternalRole" AS ENUM ('cto', 'pm', 'backend_developer', 'frontend_developer', 'mobile_developer', 'miniapp_developer', 'game_developer', 'tester', 'security', 'ops', 'qa', 'architect');

-- CreateEnum
CREATE TYPE "RequirementPriority" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('pending', 'approved', 'rejected', 'in-progress', 'testing', 'review', 'deploying', 'done', 'clarifying', 'draft', 'abandoned', 'archived');

-- CreateEnum
CREATE TYPE "RequirementType" AS ENUM ('FEATURE', 'BUGFIX', 'POSTMORTEM', 'INFRA', 'SECURITY');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in-progress', 'done');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('DEV_SELF_CHECK', 'SECURITY_REVIEW', 'TEST_REPORT', 'CTO_REVIEW', 'DEPLOY_CONFIRM', 'POSTMORTEM', 'TEST_DEPLOY_CONFIRM', 'MERGE_REPORT', 'ARCH_DESIGN', 'ARCH_REVIEW');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('pending', 'approved', 'rejected', 'changes_requested');

-- CreateEnum
CREATE TYPE "MarketplaceAgentStatus" AS ENUM ('active', 'inactive', 'maintenance');

-- CreateEnum
CREATE TYPE "MarketplaceTaskStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "MarketplacePriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "DeliverableType" AS ENUM ('text', 'image', 'document', 'url', 'file');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('online', 'offline', 'maintenance', 'unknown');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "PipelineName" AS ENUM ('content', 'parenting', 'investment', 'health', 'planning', 'lifestyle', 'devops', 'education', 'business', 'cross-cutting');

-- CreateEnum
CREATE TYPE "OkrRole" AS ENUM ('okr_admin', 'okr_reviewer', 'okr_member', 'okr_owner');

-- CreateEnum
CREATE TYPE "GoalLayer" AS ENUM ('mainline', 'explore', 'life', 'infra');

-- CreateEnum
CREATE TYPE "MonthlyGoalStatus" AS ENUM ('not_started', 'in_progress', 'done');

-- CreateEnum
CREATE TYPE "WeeklyReportStatus" AS ENUM ('draft', 'submitted', 'reviewed', 'approved', 'changes_requested');

-- CreateEnum
CREATE TYPE "PostmortemStatus" AS ENUM ('pending', 'implemented', 'verified');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('human', 'agent');

-- CreateEnum
CREATE TYPE "ExecutionLeaseStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'requester',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentId" TEXT,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "bio" TEXT,
    "phone" TEXT,
    "avatar" TEXT,
    "department" TEXT,
    "title" TEXT,
    "employeeNo" TEXT,
    "onboardingDate" TIMESTAMP(3),
    "managerId" UUID,
    "internal_role" "InternalRole",
    "okr_role" "OkrRole" NOT NULL DEFAULT 'okr_member',
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "password_changed_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "actorName" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_policies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "minLength" INTEGER NOT NULL DEFAULT 8,
    "require_uppercase" BOOLEAN NOT NULL DEFAULT true,
    "require_lowercase" BOOLEAN NOT NULL DEFAULT true,
    "require_number" BOOLEAN NOT NULL DEFAULT true,
    "require_special" BOOLEAN NOT NULL DEFAULT false,
    "expires_in_days" INTEGER,
    "force_change_cycle_days" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "password_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirements" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "RequirementPriority" NOT NULL DEFAULT 'P2',
    "requester" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "assignee" TEXT,
    "dueDate" TIMESTAMP(3),
    "attachment" TEXT,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "requesterId" UUID,
    "assigneeId" UUID,
    "notes" TEXT,
    "pm_approved_at" TIMESTAMP(3),
    "pm_approved_by" TEXT,
    "gitHash" TEXT,
    "deployVersion" TEXT,
    "type" "RequirementType" NOT NULL DEFAULT 'FEATURE',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "workflowId" UUID,
    "workflow_snapshot" JSONB,
    "currentStep" TEXT,
    "branch" TEXT,
    "repoPath" TEXT,
    "depends_on_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocked_by" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "projectId" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "state_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_revisions" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "RequirementPriority" NOT NULL,
    "status" "RequirementStatus" NOT NULL,
    "requester" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "assignee" TEXT,
    "dueDate" TIMESTAMP(3),
    "attachment" TEXT,
    "revisionNote" TEXT,
    "operatorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirement_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "qa_bypass" BOOLEAN NOT NULL DEFAULT false,
    "qa_bypass_reason" TEXT,
    "qa_bypass_at" TIMESTAMP(3),
    "qa_bypass_by" TEXT,
    "qa_reviewed_at" TIMESTAMP(3),
    "qa_reviewed_by" TEXT,
    "qa_findings" JSONB,
    "workflow_step" TEXT,

    CONSTRAINT "requirement_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "relatedReqId" UUID,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_agents" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "avatar" TEXT,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "apiEndpoint" TEXT,
    "status" "MarketplaceAgentStatus" NOT NULL DEFAULT 'active',
    "notificationType" TEXT NOT NULL DEFAULT 'polling',
    "feishuWebhookUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastHeartbeatAt" TIMESTAMP(3),
    "agentToken" TEXT,
    "ownerId" UUID,
    "openclawAgentId" TEXT,
    "registrationSource" TEXT,
    "registrationGroup" TEXT,
    "mergedInto" UUID,
    "mergedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "user_id" UUID,

    CONSTRAINT "marketplace_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_tasks" (
    "id" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "requesterId" UUID,
    "requesterName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "input" JSONB,
    "priority" "MarketplacePriority" NOT NULL DEFAULT 'normal',
    "status" "MarketplaceTaskStatus" NOT NULL DEFAULT 'pending',
    "deadline" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMsg" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "executionTimeMs" INTEGER,
    "tokensUsed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_deliverables" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "type" "DeliverableType" NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_access_tokens" (
    "id" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "agent_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "port" INTEGER,
    "localUrl" TEXT,
    "remoteUrl" TEXT,
    "techStack" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "owner" TEXT,
    "gitRepo" TEXT,
    "database" TEXT,
    "status" "ServiceStatus" NOT NULL DEFAULT 'unknown',
    "version" TEXT,
    "lastDeployedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requirements" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "relationType" TEXT NOT NULL DEFAULT 'related',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_goal_cards" (
    "id" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "pipeline" "PipelineName" NOT NULL,
    "layer" "GoalLayer" NOT NULL DEFAULT 'mainline',
    "upstreamAgentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "downstreamAgentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "longTermDirection" TEXT NOT NULL,
    "monthlyGoals" JSONB NOT NULL DEFAULT '[]',
    "selfCheckCriteria" TEXT NOT NULL,
    "pushedMonths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "GoalStatus" NOT NULL DEFAULT 'active',
    "lastReviewedAt" TIMESTAMP(3),
    "lastReviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_goal_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_revisions" (
    "id" UUID NOT NULL,
    "goalCardId" UUID NOT NULL,
    "longTermDirection" TEXT NOT NULL,
    "monthlyGoals" JSONB NOT NULL,
    "selfCheckCriteria" TEXT NOT NULL,
    "pipeline" "PipelineName" NOT NULL,
    "changeNote" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_reports" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "postmortems" (
    "id" UUID NOT NULL,
    "requirementId" UUID,
    "title" TEXT NOT NULL,
    "phenomenon" TEXT NOT NULL,
    "rootCause" TEXT NOT NULL,
    "whyExistingProcess" TEXT NOT NULL,
    "longTermPrinciple" TEXT NOT NULL,
    "preventionMeasures" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "responsiblePerson" TEXT NOT NULL,
    "status" "PostmortemStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "postmortems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_audit_logs" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "operatorId" UUID,
    "operatorName" TEXT,
    "detail" JSONB,
    "stateVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirement_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identities" (
    "id" UUID NOT NULL,
    "type" "EntityType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatar" TEXT,
    "description" TEXT NOT NULL,
    "longTermDirection" TEXT NOT NULL,
    "monthlyGoals" JSONB NOT NULL DEFAULT '[]',
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "pipeline" "PipelineName",
    "layer" "GoalLayer",
    "agentId" TEXT,
    "owner_id" TEXT,
    "agentType" TEXT,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_events" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorId" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "test_env_lock" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "requirementId" UUID NOT NULL,
    "requirementTitle" TEXT,
    "branch" TEXT,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockToken" UUID,

    CONSTRAINT "test_env_lock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_logs" (
    "id" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'working',
    "content" TEXT NOT NULL,
    "problems" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "boundaries" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "featureList" TEXT,
    "ownerId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_comments" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "parentId" UUID,
    "content" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'discussion',
    "status" TEXT NOT NULL DEFAULT 'open',
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirement_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

    CONSTRAINT "execution_leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_lease_events" (
    "id" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actorId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_lease_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_events" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "fromStep" TEXT NOT NULL,
    "toStep" TEXT NOT NULL,
    "actorId" UUID,
    "actorName" TEXT,
    "actorRole" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_agentId_key" ON "users"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "users_employeeNo_key" ON "users"("employeeNo");

-- CreateIndex
CREATE INDEX "users_last_login_at_idx" ON "users"("last_login_at");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "password_policies_name_key" ON "password_policies"("name");

-- CreateIndex
CREATE INDEX "requirements_currentStep_idx" ON "requirements"("currentStep");

-- CreateIndex
CREATE INDEX "requirements_priority_idx" ON "requirements"("priority");

-- CreateIndex
CREATE INDEX "requirements_type_idx" ON "requirements"("type");

-- CreateIndex
CREATE INDEX "requirements_requester_idx" ON "requirements"("requester");

-- CreateIndex
CREATE INDEX "requirements_requesterId_idx" ON "requirements"("requesterId");

-- CreateIndex
CREATE INDEX "requirements_assignee_idx" ON "requirements"("assignee");

-- CreateIndex
CREATE INDEX "requirements_assigneeId_idx" ON "requirements"("assigneeId");

-- CreateIndex
CREATE INDEX "requirements_projectId_idx" ON "requirements"("projectId");

-- CreateIndex
CREATE INDEX "tasks_requirementId_idx" ON "tasks"("requirementId");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_agentType_idx" ON "tasks"("agentType");

-- CreateIndex
CREATE INDEX "requirement_revisions_requirementId_idx" ON "requirement_revisions"("requirementId");

-- CreateIndex
CREATE INDEX "requirement_revisions_createdAt_idx" ON "requirement_revisions"("createdAt");

-- CreateIndex
CREATE INDEX "requirement_reports_requirementId_idx" ON "requirement_reports"("requirementId");

-- CreateIndex
CREATE INDEX "requirement_reports_reportType_idx" ON "requirement_reports"("reportType");

-- CreateIndex
CREATE INDEX "requirement_reports_submittedBy_idx" ON "requirement_reports"("submittedBy");

-- CreateIndex
CREATE INDEX "requirement_reports_status_idx" ON "requirement_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "requirement_reports_requirementId_reportType_workflow_step_key" ON "requirement_reports"("requirementId", "reportType", "workflow_step");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_agents_name_key" ON "marketplace_agents"("name");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_agents_agentToken_key" ON "marketplace_agents"("agentToken");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_agents_user_id_key" ON "marketplace_agents"("user_id");

-- CreateIndex
CREATE INDEX "marketplace_agents_status_idx" ON "marketplace_agents"("status");

-- CreateIndex
CREATE INDEX "marketplace_agents_ownerId_idx" ON "marketplace_agents"("ownerId");

-- CreateIndex
CREATE INDEX "marketplace_agents_user_id_idx" ON "marketplace_agents"("user_id");

-- CreateIndex
CREATE INDEX "marketplace_tasks_agentId_idx" ON "marketplace_tasks"("agentId");

-- CreateIndex
CREATE INDEX "marketplace_tasks_status_idx" ON "marketplace_tasks"("status");

-- CreateIndex
CREATE INDEX "marketplace_tasks_requesterId_idx" ON "marketplace_tasks"("requesterId");

-- CreateIndex
CREATE INDEX "marketplace_deliverables_taskId_idx" ON "marketplace_deliverables"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_access_tokens_token_key" ON "agent_access_tokens"("token");

-- CreateIndex
CREATE INDEX "agent_access_tokens_agentId_idx" ON "agent_access_tokens"("agentId");

-- CreateIndex
CREATE INDEX "agent_access_tokens_token_idx" ON "agent_access_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "services_name_key" ON "services"("name");

-- CreateIndex
CREATE INDEX "services_status_idx" ON "services"("status");

-- CreateIndex
CREATE INDEX "services_owner_idx" ON "services"("owner");

-- CreateIndex
CREATE INDEX "service_requirements_serviceId_idx" ON "service_requirements"("serviceId");

-- CreateIndex
CREATE INDEX "service_requirements_requirementId_idx" ON "service_requirements"("requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "service_requirements_serviceId_requirementId_key" ON "service_requirements"("serviceId", "requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_goal_cards_agentId_key" ON "agent_goal_cards"("agentId");

-- CreateIndex
CREATE INDEX "agent_goal_cards_pipeline_idx" ON "agent_goal_cards"("pipeline");

-- CreateIndex
CREATE INDEX "agent_goal_cards_status_idx" ON "agent_goal_cards"("status");

-- CreateIndex
CREATE INDEX "goal_revisions_goalCardId_idx" ON "goal_revisions"("goalCardId");

-- CreateIndex
CREATE INDEX "goal_revisions_createdAt_idx" ON "goal_revisions"("createdAt");

-- CreateIndex
CREATE INDEX "weekly_reports_agentId_idx" ON "weekly_reports"("agentId");

-- CreateIndex
CREATE INDEX "weekly_reports_week_idx" ON "weekly_reports"("week");

-- CreateIndex
CREATE INDEX "weekly_reports_status_idx" ON "weekly_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_reports_agentId_week_key" ON "weekly_reports"("agentId", "week");

-- CreateIndex
CREATE INDEX "postmortems_status_idx" ON "postmortems"("status");

-- CreateIndex
CREATE INDEX "postmortems_responsiblePerson_idx" ON "postmortems"("responsiblePerson");

-- CreateIndex
CREATE INDEX "postmortems_requirementId_idx" ON "postmortems"("requirementId");

-- CreateIndex
CREATE INDEX "requirement_audit_logs_requirementId_idx" ON "requirement_audit_logs"("requirementId");

-- CreateIndex
CREATE INDEX "requirement_audit_logs_action_idx" ON "requirement_audit_logs"("action");

-- CreateIndex
CREATE INDEX "requirement_audit_logs_createdAt_idx" ON "requirement_audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "identities_agentId_key" ON "identities"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "identities_userId_key" ON "identities"("userId");

-- CreateIndex
CREATE INDEX "identities_type_idx" ON "identities"("type");

-- CreateIndex
CREATE INDEX "identities_pipeline_idx" ON "identities"("pipeline");

-- CreateIndex
CREATE INDEX "identities_owner_id_idx" ON "identities"("owner_id");

-- CreateIndex
CREATE INDEX "identities_status_idx" ON "identities"("status");

-- CreateIndex
CREATE INDEX "pipeline_events_taskId_idx" ON "pipeline_events"("taskId");

-- CreateIndex
CREATE INDEX "pipeline_events_toStatus_actor_idx" ON "pipeline_events"("toStatus", "actor");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_templates_name_key" ON "workflow_templates"("name");

-- CreateIndex
CREATE INDEX "workflow_templates_isActive_idx" ON "workflow_templates"("isActive");

-- CreateIndex
CREATE INDEX "workflow_transitions_requirementId_idx" ON "workflow_transitions"("requirementId");

-- CreateIndex
CREATE INDEX "workflow_transitions_fromStep_idx" ON "workflow_transitions"("fromStep");

-- CreateIndex
CREATE INDEX "workflow_transitions_createdAt_idx" ON "workflow_transitions"("createdAt");

-- CreateIndex
CREATE INDEX "daily_logs_date_idx" ON "daily_logs"("date");

-- CreateIndex
CREATE INDEX "daily_logs_agentId_idx" ON "daily_logs"("agentId");

-- CreateIndex
CREATE INDEX "daily_logs_submittedAt_idx" ON "daily_logs"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "daily_logs_agentId_date_key" ON "daily_logs"("agentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "projects_name_key" ON "projects"("name");

-- CreateIndex
CREATE INDEX "requirement_comments_requirementId_idx" ON "requirement_comments"("requirementId");

-- CreateIndex
CREATE INDEX "requirement_comments_authorId_idx" ON "requirement_comments"("authorId");

-- CreateIndex
CREATE INDEX "requirement_comments_parentId_idx" ON "requirement_comments"("parentId");

-- CreateIndex
CREATE INDEX "requirement_comments_status_idx" ON "requirement_comments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "execution_leases_claimKey_key" ON "execution_leases"("claimKey");

-- CreateIndex
CREATE INDEX "execution_leases_requirementId_status_idx" ON "execution_leases"("requirementId", "status");

-- CreateIndex
CREATE INDEX "execution_leases_status_expiresAt_idx" ON "execution_leases"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "execution_lease_events_idempotencyKey_key" ON "execution_lease_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "execution_lease_events_leaseId_idx" ON "execution_lease_events"("leaseId");

-- CreateIndex
CREATE INDEX "execution_lease_events_createdAt_idx" ON "execution_lease_events"("createdAt");

-- CreateIndex
CREATE INDEX "feedback_events_requirementId_idx" ON "feedback_events"("requirementId");

-- CreateIndex
CREATE INDEX "feedback_events_createdAt_idx" ON "feedback_events"("createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_revisions" ADD CONSTRAINT "requirement_revisions_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_revisions" ADD CONSTRAINT "requirement_revisions_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_reports" ADD CONSTRAINT "requirement_reports_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_reports" ADD CONSTRAINT "requirement_reports_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_agents" ADD CONSTRAINT "marketplace_agents_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_agents" ADD CONSTRAINT "marketplace_agents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_tasks" ADD CONSTRAINT "marketplace_tasks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "marketplace_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_tasks" ADD CONSTRAINT "marketplace_tasks_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_deliverables" ADD CONSTRAINT "marketplace_deliverables_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "marketplace_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_access_tokens" ADD CONSTRAINT "agent_access_tokens_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "marketplace_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requirements" ADD CONSTRAINT "service_requirements_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requirements" ADD CONSTRAINT "service_requirements_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_goal_cards" ADD CONSTRAINT "agent_goal_cards_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "marketplace_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_revisions" ADD CONSTRAINT "goal_revisions_goalCardId_fkey" FOREIGN KEY ("goalCardId") REFERENCES "agent_goal_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "marketplace_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postmortems" ADD CONSTRAINT "postmortems_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_audit_logs" ADD CONSTRAINT "requirement_audit_logs_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "marketplace_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_comments" ADD CONSTRAINT "requirement_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_comments" ADD CONSTRAINT "requirement_comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "requirement_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_comments" ADD CONSTRAINT "requirement_comments_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_leases" ADD CONSTRAINT "execution_leases_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_leases" ADD CONSTRAINT "execution_leases_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_lease_events" ADD CONSTRAINT "execution_lease_events_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "execution_leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Seed data and data backfills (not generated by migrate diff --script)
-- Source migrations:
--   20260530150200_add_workflow_engine (corrected for updatedAt NOT NULL)
--   20260602000100_add_password_policy
--   20260612190001_seed_test_env_lock
-- ============================================================================

-- Password policy default seed
INSERT INTO "password_policies" ("id", "name", "minLength", "require_uppercase", "require_lowercase", "require_number", "require_special", "is_default", "createdAt", "updatedAt") VALUES (gen_random_uuid(), 'default', 8, true, true, true, false, true, NOW(), NOW()) ON CONFLICT ("name") DO NOTHING;

-- Password changedAt backfill (no-op on fresh DB)
UPDATE "users" SET "password_changed_at" = "createdAt" WHERE "password_changed_at" IS NULL;

-- Workflow templates seeds (with createdAt + updatedAt to satisfy NOT NULL)
INSERT INTO "workflow_templates" ("id","name","displayName","description","steps","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(),'backend-dev','后端开发','标准后端开发流程',
  '[{"name":"dev_self_check","displayName":"开发自检","role":"developer","requiredReports":["DEV_SELF_CHECK"],"autoAdvance":false},{"name":"test","displayName":"测试验证","role":"tester","requiredReports":["TEST_REPORT"],"autoAdvance":false},{"name":"cto_review","displayName":"CTO审核","role":"cto","requiredReports":["CTO_REVIEW"],"autoAdvance":false},{"name":"deploy","displayName":"部署上线","role":"ops","requiredReports":["DEPLOY_CONFIRM"],"autoAdvance":false},{"name":"done","displayName":"完成","role":"auto","requiredReports":[],"autoAdvance":true}]'::jsonb,true,NOW(),NOW();

INSERT INTO "workflow_templates" ("id","name","displayName","description","steps","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(),'frontend-dev','前端开发','标准前端开发流程',
  '[{"name":"dev_self_check","displayName":"开发自检","role":"developer","requiredReports":["DEV_SELF_CHECK"],"autoAdvance":false},{"name":"test","displayName":"测试验证","role":"tester","requiredReports":["TEST_REPORT"],"autoAdvance":false},{"name":"cto_review","displayName":"CTO审核","role":"cto","requiredReports":["CTO_REVIEW"],"autoAdvance":false},{"name":"deploy","displayName":"部署上线","role":"ops","requiredReports":["DEPLOY_CONFIRM"],"autoAdvance":false},{"name":"done","displayName":"完成","role":"auto","requiredReports":[],"autoAdvance":true}]'::jsonb,true,NOW(),NOW();

INSERT INTO "workflow_templates" ("id","name","displayName","description","steps","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(),'ops-deploy','运维部署','运维部署流程',
  '[{"name":"deploy","displayName":"部署执行","role":"ops","requiredReports":["DEPLOY_CONFIRM"],"autoAdvance":false},{"name":"verify","displayName":"部署验证","role":"tester","requiredReports":["TEST_REPORT"],"autoAdvance":false},{"name":"done","displayName":"完成","role":"auto","requiredReports":[],"autoAdvance":true}]'::jsonb,true,NOW(),NOW();

INSERT INTO "workflow_templates" ("id","name","displayName","description","steps","isActive","createdAt","updatedAt")
SELECT gen_random_uuid(),'hotfix','紧急修复','紧急修复流程',
  '[{"name":"dev_self_check","displayName":"开发自检","role":"developer","requiredReports":["DEV_SELF_CHECK"],"autoAdvance":false},{"name":"deploy","displayName":"紧急部署","role":"ops","requiredReports":["DEPLOY_CONFIRM"],"autoAdvance":false},{"name":"done","displayName":"完成","role":"auto","requiredReports":[],"autoAdvance":true}]'::jsonb,true,NOW(),NOW();

-- Test env lock singleton seed
INSERT INTO "test_env_lock" ("id", "requirementId", "acquiredAt")
SELECT 'singleton', gen_random_uuid(), NOW() - INTERVAL '365 days'
WHERE NOT EXISTS(SELECT 1 FROM "test_env_lock" WHERE "id"='singleton');
