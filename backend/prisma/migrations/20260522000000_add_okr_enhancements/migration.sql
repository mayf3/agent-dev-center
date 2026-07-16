-- OKR 独立权限体系
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OkrRole') THEN
    CREATE TYPE "OkrRole" AS ENUM ('okr_admin', 'okr_reviewer', 'okr_member', 'okr_owner');
  END IF;
END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "okr_role" "OkrRole" DEFAULT 'okr_member';

-- Set OKR roles for known users
UPDATE "users" SET "okr_role" = 'okr_admin' WHERE "email" = 'ceo-agent@agent.local';
UPDATE "users" SET "okr_role" = 'okr_reviewer' WHERE "email" = 'efficiency-agent@agent.local';
UPDATE "users" SET "okr_role" = 'okr_owner' WHERE "email" IN ('admin@agent.dev', 'cto@agent.local');

-- PipelineName was never created in earlier migrations, only referenced incrementally
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PipelineName') THEN
    CREATE TYPE "PipelineName" AS ENUM ('idea', 'requirement', 'development', 'qa', 'deploy', 'done');
  END IF;
END $$;

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

-- agent_goal_cards table may not exist yet; create it if missing before adding the layer column
CREATE TABLE IF NOT EXISTS "agent_goal_cards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agentId" UUID NOT NULL,
    "pipeline" "PipelineName" NOT NULL,
    "layer" "GoalLayer" DEFAULT 'mainline',
    "upstreamAgentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "downstreamAgentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "longTermDirection" TEXT NOT NULL DEFAULT '',
    "monthlyGoals" JSONB NOT NULL DEFAULT '[]',
    "selfCheckCriteria" TEXT NOT NULL DEFAULT '',
    "pushedMonths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastReviewedAt" TIMESTAMP(3),
    "lastReviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_goal_cards_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_goal_cards_agentId_key" UNIQUE ("agentId")
);

ALTER TABLE "agent_goal_cards" ADD COLUMN IF NOT EXISTS "layer" "GoalLayer" DEFAULT 'mainline';
