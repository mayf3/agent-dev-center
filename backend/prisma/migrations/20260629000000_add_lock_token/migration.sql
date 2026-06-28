-- Expansion stage: add nullable lockToken column for acquisition generation tracking.
-- NOT NULL and expiry contract migration will follow after all old code has been
-- updated and every active row carries a valid UUID token.
ALTER TABLE "test_env_lock"
ADD COLUMN "lockToken" UUID;
