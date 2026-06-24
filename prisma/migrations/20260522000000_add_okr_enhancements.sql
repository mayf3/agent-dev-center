-- OKR 独立权限体系
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OkrRole') THEN
    CREATE TYPE "OkrRole" AS ENUM ('okr_admin', 'okr_reviewer', 'okr_member', 'okr_owner');
  END IF;
END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "okr_role" "OkrRole" DEFAULT 'okr_member';

-- Set OKR roles for known users
UPDATE "users" SET "okr_role" = 'okr_admin' WHERE "email" = 'ceo-agent@example.com';
UPDATE "users" SET "okr_role" = 'okr_reviewer' WHERE "email" = 'efficiency-agent@example.com';
UPDATE "users" SET "okr_role" = 'okr_owner' WHERE "email" IN ('admin@example.com', 'cto@example.com');

-- PipelineName expansion
ALTER TYPE "PipelineName" ADD VALUE IF NOT EXISTS 'business';
DO $$ BEGIN
  ALTER TYPE "PipelineName" ADD VALUE 'cross_cutting';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- GoalLayer enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GoalLayer') THEN
    CREATE TYPE "GoalLayer" AS ENUM ('mainline', 'explore', 'life', 'infra');
  END IF;
END $$;

ALTER TABLE "agent_goal_cards" ADD COLUMN IF NOT EXISTS "layer" "GoalLayer" DEFAULT 'mainline';
