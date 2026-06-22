-- CreateEnum
CREATE TYPE "MarketplaceAgentStatus" AS ENUM ('active', 'inactive', 'maintenance');

-- CreateEnum
CREATE TYPE "MarketplaceTaskStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "MarketplacePriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "DeliverableType" AS ENUM ('text', 'image', 'document', 'url', 'file');

-- AlterEnum
ALTER TYPE "RequirementStatus" ADD VALUE 'deploying';

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "requirement_revisions" ALTER COLUMN "priority" DROP DEFAULT,
ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable
ALTER TABLE "requirements" ADD COLUMN     "deployVersion" TEXT,
ADD COLUMN     "gitHash" TEXT,
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_requirements" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "services" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tasks" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;

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
    "ownerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_agents_name_key" ON "marketplace_agents"("name");

-- CreateIndex
CREATE INDEX "marketplace_agents_status_idx" ON "marketplace_agents"("status");

-- CreateIndex
CREATE INDEX "marketplace_tasks_agentId_idx" ON "marketplace_tasks"("agentId");

-- CreateIndex
CREATE INDEX "marketplace_tasks_status_idx" ON "marketplace_tasks"("status");

-- CreateIndex
CREATE INDEX "marketplace_tasks_requesterId_idx" ON "marketplace_tasks"("requesterId");

-- CreateIndex
CREATE INDEX "marketplace_deliverables_taskId_idx" ON "marketplace_deliverables"("taskId");

-- AddForeignKey
ALTER TABLE "marketplace_agents" ADD CONSTRAINT "marketplace_agents_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_tasks" ADD CONSTRAINT "marketplace_tasks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "marketplace_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_tasks" ADD CONSTRAINT "marketplace_tasks_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_deliverables" ADD CONSTRAINT "marketplace_deliverables_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "marketplace_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
