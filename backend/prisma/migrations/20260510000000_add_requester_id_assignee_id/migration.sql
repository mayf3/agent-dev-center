-- AlterTable: Requirement 添加 requesterId 和 assigneeId 字段
-- 用于权限匹配基于 UUID 而非 name 字符串

ALTER TABLE "requirements" ADD COLUMN "requesterId" UUID;
ALTER TABLE "requirements" ADD COLUMN "assigneeId" UUID;

-- 添加外键约束
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 创建索引
CREATE INDEX "requirements_requesterId_idx" ON "requirements"("requesterId");
CREATE INDEX "requirements_assigneeId_idx" ON "requirements"("assigneeId");

-- 数据回填：根据 requester name/email 匹配 user ID
UPDATE "requirements" r
SET "requesterId" = u.id
FROM "users" u
WHERE r.requester = u.name OR r.requester = u.email;

-- 数据回填：根据 assignee name/email 匹配 user ID
UPDATE "requirements" r
SET "assigneeId" = u.id
FROM "users" u
WHERE r.assignee = u.name OR r.assignee = u.email;
