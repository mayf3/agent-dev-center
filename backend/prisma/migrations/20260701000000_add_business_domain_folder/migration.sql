-- ============================================================================
-- BusinessDomain / Folder V1 (Expansion phase)
--
-- Adds the single canonical Folder entity (BusinessDomain), the domain→role
-- binding table (DomainRoleBinding), and a nullable Requirement.domainKey.
--
-- Migration order (must be reliable on both fresh and existing DBs):
--   1. CREATE BusinessDomain
--   2. CREATE DomainRoleBinding
--   3. ALTER Requirement ADD nullable domain_key  (no FK yet)
--   4. SEED system domains
--   5. BACKFILL Requirement.domainKey -> 'engineering' for any NULL
--   6. ADD FK (Restrict) + index  (last, so backfill never violates the FK)
--
-- domain_key stays nullable in this batch. A later batch enforces NOT NULL.
-- ============================================================================

-- ── 1. BusinessDomain ───────────────────────────────────────────────────────
CREATE TABLE "business_domains" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_domains_pkey" PRIMARY KEY ("key")
);

-- ── 2. DomainRoleBinding ────────────────────────────────────────────────────
CREATE TABLE "domain_role_bindings" (
    "id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "domain_key" TEXT NOT NULL,
    "is_domain_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_global" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_role_bindings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "domain_role_bindings_role_domain_key_key" ON "domain_role_bindings"("role", "domain_key");
CREATE INDEX "domain_role_bindings_domain_key_idx" ON "domain_role_bindings"("domain_key");
CREATE INDEX "domain_role_bindings_role_idx" ON "domain_role_bindings"("role");

-- FK binding→domain (cascade: deleting a domain clears its bindings)
ALTER TABLE "domain_role_bindings" ADD CONSTRAINT "domain_role_bindings_domain_key_fkey"
    FOREIGN KEY ("domain_key") REFERENCES "business_domains"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. Requirement.domain_key (nullable, no FK yet) ─────────────────────────
ALTER TABLE "requirements" ADD COLUMN "domain_key" TEXT;

-- ── 4. Seed system domains ──────────────────────────────────────────────────
-- Stable keys + readable names. Idempotent via ON CONFLICT.
INSERT INTO "business_domains" ("key", "name", "description", "is_active", "is_system", "updated_at")
VALUES
    ('engineering',  'Engineering',   'Software engineering & platform work', true, true, CURRENT_TIMESTAMP),
    ('operations',   'Operations',    'Infrastructure, ops & deployment',      true, true, CURRENT_TIMESTAMP),
    ('content',      'Content',       'Content creation & editorial',          true, true, CURRENT_TIMESTAMP),
    ('learning',     'Learning',      'Learning & skill development',          true, true, CURRENT_TIMESTAMP),
    ('personal',     'Personal',      'Personal tasks & life admin',           true, true, CURRENT_TIMESTAMP),
    ('family',       'Family',        'Family & household',                    true, true, CURRENT_TIMESTAMP),
    ('health',       'Health',        'Health & wellness',                     true, true, CURRENT_TIMESTAMP),
    ('finance',      'Finance',       'Finance & money management',            true, true, CURRENT_TIMESTAMP),
    ('legacy-todo',  'Legacy Todo',   'Pre-Folder todo backlog (migrated)',    true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- ── 4b. Seed initial role bindings (idempotent via (role,domain_key) unique key)
--    Only adc:admin gets cross-domain (is_global).  Standard engineering roles
--    get member-level access to engineering + legacy-todo (migration backlog).
--    Ops additionally gets operations domain.
--    Personal/family/health/finance/content/learning have NO default bindings:
--    only adc:admin (is_global=true) can access them.
--    This ensures existing users don't get fail-closed after migration deploy.
-- ============================================================================
INSERT INTO "domain_role_bindings" ("id", "role", "domain_key", "is_domain_admin", "is_global", "updated_at")
VALUES
    (gen_random_uuid(), 'adc:admin', 'engineering', true, true, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:developer', 'engineering', false, false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:developer', 'legacy-todo', false, false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:tester', 'engineering', false, false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:tester', 'legacy-todo', false, false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:security', 'engineering', false, false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:security', 'legacy-todo', false, false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:ops', 'operations', true, false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:ops', 'engineering', false, false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:ops', 'legacy-todo', false, false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:pm', 'engineering', false, false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:pm', 'legacy-todo', false, false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:qa', 'engineering', false, false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:qa', 'legacy-todo', false, false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:viewer', 'engineering', false, false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'adc:viewer', 'legacy-todo', false, false, CURRENT_TIMESTAMP)
ON CONFLICT ("role", "domain_key") DO NOTHING;

-- ── 5. Backfill Requirement.domainKey ───────────────────────────────────────
-- Classification rule: only assign a non-engineering domain when the existing
-- data is unambiguous. With no reliable per-row signal (department/project/tags
-- are free-text and may be empty), the safe default for all NULL rows is
-- 'engineering'. Existing rows keep whatever domain_key they already have.
UPDATE "requirements"
SET "domain_key" = 'engineering'
WHERE "domain_key" IS NULL;

-- ── 6. FK (Restrict) + index — added LAST so backfill cannot violate it ─────
CREATE INDEX "requirements_domain_key_idx" ON "requirements"("domain_key");

ALTER TABLE "requirements" ADD CONSTRAINT "requirements_domain_key_fkey"
    FOREIGN KEY ("domain_key") REFERENCES "business_domains"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
