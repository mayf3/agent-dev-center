-- ============================================================================
-- Agent Todo V1 — BusinessDomain + Workflow Template + DomainRoleBindings
--
-- Adds:
--   1. "agent-todo" BusinessDomain (the official Agent-Todo folder)
--   2. Minimal domain_role_bindings for Agent Todo access
--   3. "agent-todo-v1" Workflow Template (6-step lifecycle with rejectTo)
--
-- Idempotent (safe for repeated prisma migrate deploy).
-- Does NOT modify existing 9 domains, 16 bindings, or any legacy-todo data.
-- ============================================================================

-- ── 1. Agent Todo domain ────────────────────────────────────────────────────
INSERT INTO "business_domains" ("key", "name", "description", "is_active", "is_system", "updated_at")
VALUES (
  'agent-todo',
  'Agent Todo',
  'Agent Todo: ADC Requirement + Workflow 表达的 Agent Todo 场景',
  true,
  true,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;

-- ── 2. Domain role bindings (minimal) ───────────────────────────────────────
--   • adc:admin already has is_global=true from Folder migration — no binding needed
--   • adc:pm — PMs create and oversee Agent Todo tasks
--   • adc:developer — Developers may create and view Agent Todos
--   • adc:ops — Operations may need to view Agent Todo context
--
--   Actual workflow step operations (efficiency_review, execution, etc.) are
--   controlled by per-instance roleUserMap stored in workflowSnapshot — NOT
--   by DomainRoleBinding. These bindings only gate create/read access to the
--   agent-todo domain itself.
-- ============================================================================
INSERT INTO "domain_role_bindings" ("id", "role", "domain_key", "is_domain_admin", "is_global", "updated_at")
VALUES
  (gen_random_uuid(), 'adc:pm', 'agent-todo', false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'adc:developer', 'agent-todo', false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'adc:ops', 'agent-todo', false, false, CURRENT_TIMESTAMP)
ON CONFLICT ("role", "domain_key") DO NOTHING;

-- ── 3. Agent Todo V1 workflow template ─────────────────────────────────────
-- Format: {steps: [...], roleUserMap: {}}
--   • roleUserMap is empty at template level — filled per-requirement at create time
--   • Steps use instance-role names (not platform internalRole values)
--   • Each step has explicit `next` and `rejectTo` for deterministic routing
-- ============================================================================
INSERT INTO "workflow_templates" ("id", "name", "displayName", "description", "steps", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  'agent-todo-v1',
  'Agent Todo V1',
  'Agent Todo 标准执行与验收流程：效率审核 → 伙伴审核 → 执行 → 效率验收 → 伙伴最终复核 → 完成',
  jsonb_build_object(
    'steps', jsonb_build_array(
      jsonb_build_object(
        'name', 'efficiency_review',
        'displayName', '效率审核',
        'role', 'efficiency-manager',
        'requiredReports', '[]'::jsonb,
        'autoAdvance', false,
        'next', 'partner_review',
        'rejectTo', 'efficiency_review'
      ),
      jsonb_build_object(
        'name', 'partner_review',
        'displayName', '伙伴审核',
        'role', 'lobster-partner',
        'requiredReports', '[]'::jsonb,
        'autoAdvance', false,
        'next', 'execution',
        'rejectTo', 'efficiency_review'
      ),
      jsonb_build_object(
        'name', 'execution',
        'displayName', '执行',
        'role', 'executor',
        'requiredReports', '[]'::jsonb,
        'autoAdvance', false,
        'next', 'efficiency_acceptance',
        'rejectTo', 'partner_review'
      ),
      jsonb_build_object(
        'name', 'efficiency_acceptance',
        'displayName', '效率验收',
        'role', 'efficiency-manager',
        'requiredReports', '[]'::jsonb,
        'autoAdvance', false,
        'next', 'partner_final_review',
        'rejectTo', 'execution'
      ),
      jsonb_build_object(
        'name', 'partner_final_review',
        'displayName', '伙伴最终复核',
        'role', 'lobster-partner',
        'requiredReports', '[]'::jsonb,
        'autoAdvance', false,
        'next', 'done',
        'rejectTo', 'execution'
      ),
      jsonb_build_object(
        'name', 'done',
        'displayName', '完成',
        'role', 'auto',
        'requiredReports', '[]'::jsonb,
        'autoAdvance', true
      )
    ),
    'roleUserMap', '{}'::jsonb
  ),
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "workflow_templates" WHERE "name" = 'agent-todo-v1'
);
