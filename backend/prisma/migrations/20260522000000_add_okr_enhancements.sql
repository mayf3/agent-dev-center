-- OKR 增强字段
-- Add okr_role column to users
ALTER TABLE "users" ADD COLUMN "okr_role" TEXT;

-- Note: okr_role assignments moved to seed.ts
-- UPDATE "users" SET "okr_role" = 'okr_admin' WHERE "email" = 'admin@example.com';
-- UPDATE "users" SET "okr_role" = 'okr_reviewer' WHERE "email" = 'reviewer@example.com';
-- UPDATE "users" SET "okr_role" = 'okr_owner' WHERE "email" IN ('admin@example.com', 'tech-lead@example.com');

-- Other OKR enhancements
ALTER TABLE "objectives" ADD COLUMN IF NOT EXISTS "progress" INTEGER DEFAULT 0;
ALTER TABLE "key_results" ADD COLUMN IF NOT EXISTS "owner_id" TEXT;
