-- Split from 20260604000000_add_roles: cto_agent enum value must be in its own
-- transaction so it can be referenced in UPDATE statements. PostgreSQL 13+
-- does not allow newly-added enum values to be used until after commit.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'cto_agent';
