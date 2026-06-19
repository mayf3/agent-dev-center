-- 4d94ab81: Add profile/HR fields to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "bio" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "avatar" TEXT,
  ADD COLUMN IF NOT EXISTS "department" TEXT,
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "employeeNo" TEXT,
  ADD COLUMN IF NOT EXISTS "onboardingDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "managerId" UUID REFERENCES users(id);

-- Unique index for employeeNo
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_no ON users("employeeNo") WHERE "employeeNo" IS NOT NULL;
