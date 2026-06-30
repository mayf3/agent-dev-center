# Migration Plan: 19e0e2bd — ADC Database Schema Governance

## Overview
ADC Postgres contains extraneous tables that belong in svc-okr or should be merged into users.

## Phase 1: OKR Tables → svc-okr (low risk, no ADC code depends on them for core workflow)

### Tables to remove from ADC schema:
| Table | Model | Lines |
|------|-------|-------|
| agent_goal_cards | AgentGoalCard | 368-390 |
| goal_revisions | GoalRevision | 392-408 |
| weekly_reports | WeeklyReport | 410-427 |

### Affected routes (to be deprecated):
- backend/src/routes/agents/okr.ts — OKR queries (move to svc-okr)
- backend/src/routes/goals/core.ts, lifecycle.ts, permissions.ts — Goal CRUD
- backend/src/routes/agents/reports.ts — Weekly reports

### Migration steps:
1. Export data via `pg_dump -t agent_goal_cards -t goal_revisions -t weekly_reports` from ADC
2. Import into svc-okr database
3. Remove models from schema.prisma
4. Remove affected routes (replace with proxy to svc-okr)
5. Generate migration: `npx prisma migrate dev --name remove-okr-tables`

## Phase 2: MarketplaceAgent merge into User (medium risk)

### Fields to migrate from MarketplaceAgent → User:
| MarketplaceAgent field | User equivalent | Action |
|----------------------|-----------------|--------|
| name | (existing) | Already linked via userId |
| displayName | name (existing) | Already exists |
| description | — | Add `agentDescription String?` to User |
| capabilities | — | Add `capabilities Json @default("[]")` to User |
| apiEndpoint | — | Add `apiEndpoint String?` to User |
| status | — | Use `enabled` (existing) |
| tags | roles (existing) | Map tags → roles |
| agentToken | — | Add `agentToken String? @unique` to User |
| openclawAgentId | — | Add `openclawAgentId String?` to User |
| lastHeartbeatAt | — | Add `lastHeartbeatAt DateTime?` to User |

### Tables to remove after merge:
- marketplace_agents
- marketplace_tasks (deprecated, replaced by requirements)
- marketplace_deliverables (deprecated)
- daily_logs (move agentId ref to userId)

### Migration steps:
1. Add new fields to User model
2. Backfill: UPDATE users SET agent_description = ma.description, ... FROM marketplace_agents ma WHERE ma.user_id = users.id
3. Update all foreign keys: daily_logs.agentId → daily_logs.userId
4. Remove MarketplaceAgent model + relations
5. Generate migration: `npx prisma migrate dev --name merge-marketplace-into-users`
6. Update all routes that reference MarketplaceAgent

## Phase 3: Cleanup
- Drop enums: MarketplaceAgentStatus, MarketplaceTaskStatus, WeeklyReportStatus, DeliverableType
- Remove marketplace route files
- Update app.ts to remove marketplace route registration

## Risk Assessment
- **OKR removal**: Low risk — ADC core workflow doesn't depend on OKR data
- **Marketplace merge**: Medium risk — 15+ route files reference MarketplaceAgent
- **Rollback**: `prisma migrate resolve --rolled-back` + restore from DB backup

## Estimated effort: 2-3 days (split into 3 PRs recommended)
