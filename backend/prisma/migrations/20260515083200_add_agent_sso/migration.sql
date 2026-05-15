-- AlterEnum: Add 'agent' to UserRole
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'agent';

-- AlterTable: Add SSO Agent fields to users
ALTER TABLE "users" ADD COLUMN "agentId" TEXT;
ALTER TABLE "users" ADD COLUMN "permissions" JSONB NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX "users_agentId_key" ON "users"("agentId");
