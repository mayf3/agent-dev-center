CREATE TYPE "UserRole" AS ENUM ('admin', 'requester', 'developer');
CREATE TYPE "RequirementPriority" AS ENUM ('P0', 'P1', 'P2', 'P3');
CREATE TYPE "RequirementStatus" AS ENUM ('pending', 'approved', 'rejected', 'in-progress', 'testing', 'review', 'done');
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in-progress', 'done');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'requester',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "requirements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "priority" "RequirementPriority" NOT NULL DEFAULT 'P2',
  "status" "RequirementStatus" NOT NULL DEFAULT 'pending',
  "requester" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "assignee" TEXT,
  "dueDate" TIMESTAMP(3),
  "attachment" TEXT,
  "rejectReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "requirementId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "agentType" TEXT NOT NULL,
  "status" "TaskStatus" NOT NULL DEFAULT 'todo',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "requirements_status_idx" ON "requirements"("status");
CREATE INDEX "requirements_priority_idx" ON "requirements"("priority");
CREATE INDEX "requirements_requester_idx" ON "requirements"("requester");
CREATE INDEX "requirements_assignee_idx" ON "requirements"("assignee");
CREATE INDEX "tasks_requirementId_idx" ON "tasks"("requirementId");
CREATE INDEX "tasks_status_idx" ON "tasks"("status");
CREATE INDEX "tasks_agentType_idx" ON "tasks"("agentType");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_requirementId_fkey"
  FOREIGN KEY ("requirementId") REFERENCES "requirements"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
