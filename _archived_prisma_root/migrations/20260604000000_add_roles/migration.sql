ALTER TABLE "users" ADD COLUMN "roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "users" SET "roles" = ARRAY['adc:admin'] WHERE "internal_role" = 'cto';
UPDATE "users" SET "roles" = ARRAY['adc:pm'] WHERE "internal_role" = 'pm';
UPDATE "users" SET "roles" = ARRAY['adc:developer'] WHERE "internal_role" = 'developer';
UPDATE "users" SET "roles" = ARRAY['adc:tester'] WHERE "internal_role" = 'tester';
UPDATE "users" SET "roles" = ARRAY['adc:security'] WHERE "internal_role" = 'security';
UPDATE "users" SET "roles" = ARRAY['adc:ops'] WHERE "internal_role" = 'ops';
UPDATE "users" SET "roles" = ARRAY['adc:qa'] WHERE "internal_role" = 'qa';
UPDATE "users" SET "roles" = ARRAY['adc:viewer'] WHERE "internal_role" IS NULL AND "role" = 'requester';
UPDATE "users" SET "roles" = ARRAY['adc:developer'] WHERE "internal_role" IS NULL AND "role" = 'developer';
UPDATE "users" SET "roles" = ARRAY['adc:admin'] WHERE "role" = 'cto_agent';
