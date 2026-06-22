-- Add password tracking fields to users
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "password_changed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "users_last_login_at_idx" ON "users"("last_login_at");

-- Create password_policies table
CREATE TABLE IF NOT EXISTS "password_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "minLength" INTEGER NOT NULL DEFAULT 8,
    "require_uppercase" BOOLEAN NOT NULL DEFAULT true,
    "require_lowercase" BOOLEAN NOT NULL DEFAULT true,
    "require_number" BOOLEAN NOT NULL DEFAULT true,
    "require_special" BOOLEAN NOT NULL DEFAULT false,
    "expires_in_days" INTEGER,
    "force_change_cycle_days" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "password_policies_name_key" ON "password_policies"("name");

-- Seed default policy
INSERT INTO "password_policies" ("name", "minLength", "require_uppercase", "require_lowercase", "require_number", "require_special", "is_default")
VALUES ('default', 8, true, true, true, false, true)
ON CONFLICT ("name") DO NOTHING;

-- Backfill passwordChangedAt from createdAt for existing users
UPDATE "users" SET "password_changed_at" = "createdAt" WHERE "password_changed_at" IS NULL;
