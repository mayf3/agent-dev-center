# ADC V2 rewrite baseline

Date: 2026-07-16

Status: `FROZEN_WITH_STAGE_1_HARD_STOPS`

This report freezes the product and code baseline for the minimal ADC V2. It is
read-only evidence and design only. It does not merge the V1 cutover candidate,
change `svc-workflow`, contact production, provision an identity, or migrate a
legacy row.

```text
ADC_V2_REWRITE_BASELINE_FROZEN
```

## 1. Frozen product boundary

ADC V2 is a thin developer-delivery console over `svc-workflow`:

- a new development item is a `WorkflowInstance`, not an ADC `Requirement`;
- `svc-workflow` owns identity, context, current visit, assignee, state version,
  submissions, transitions, receipts, events, visibility, and permissions;
- ADC does not calculate the next node or mirror workflow state into local
  `currentStep`, `status`, `assignee`, or `stateVersion` fields;
- new-item create calls `svc-workflow` directly with an `Idempotency-Key`;
- no permanent `WorkflowOutbox`, local `Requirement`, artifact state machine, or
  workflow projection is introduced for new items;
- legacy IDs are compatibility aliases or read-only archive entries, never new
  business authority.

The V1 candidate is evidence and selective source material. It is not the base
architecture for V2.

## 2. Exact repository baseline

| Object | Branch/ref | Commit | Tree / state |
| --- | --- | --- | --- |
| ADC target | `develop` | `939a93edfa88d06ba234709284c78070212f7137` | tree `15adf5178b62bb6fc02bdb8c29a49b4f26023310`; only pre-existing untracked `.zcode/` and V1 audit report |
| ADC V2 worktree | `codex/adc-v2-minimal` | `939a93edfa88d06ba234709284c78070212f7137` | clean at creation |
| ADC V1 candidate | `codex/adc-svc-workflow-cutover-v1` | `0bec8fed8079c47e255f2e88c6dfa3a6fc332d6e` | tree `6297d1d29c5b25e3df597b3b1efd74064a418768`; clean; one commit over `develop` |
| `svc-workflow` local main | `main` | `4a7b3a324e97410441b3f65c01e3b27f835ad85b` | tree `06ae6f0c7598ec60228fe0de264c5b8f85388675`; tracked clean, six pre-existing untracked reports |
| `svc-workflow` live remote main | `refs/heads/main` | `ac8cc80640701286ec6567b1529d8279887dc9a3` | local main is 14 commits ahead of live remote |
| complete Legacy Import implementation | local commit | `4a1146e738bf0de7836f8cfaa3a8182f54515e4c` | tree `9bd4790c09c9e6bee16a8b9a5ec0e29c11b6bcad`; not on live remote feature ref |
| Legacy Import audit | local commit | `7bb8cc402bcf07d3d5c0ae4286995f4e527b4b92` | tree `ebfda4f4cfbb0fe7f7f62f386228ca8c3c60af09`; not on live remote feature ref |
| live remote Legacy feature | `refs/heads/codex/legacy-initial-import-v0` | `6a97c95edb8fba7ebee9173e043756f2dcedaf17` | initial implementation only |
| auth local smoke object | `feat/workflow-agent-obo-token-exchange-v0` | `3af27e7c5fddab7e5747d7c945e06db8faa78da9` | tree `b70429cd27e5d5197cc441ba82c9701ddc35dd52`; tracked clean, audit report untracked |
| auth live remote main | `refs/heads/main` | `d0da1ee7585dcf5260490e616a7ee307e7e07367` | does not contain the local OBO object |

No remote ref was changed. No existing worktree or untracked report was removed.

## 3. V1 audit and disposition

The V1 diff is exactly 47 files, 2,297 insertions, and 66 deletions. Its
independent audit report is currently untracked in the ADC target checkout and
records one open High because its dual-service smoke evidence was not attached to
the frozen candidate. V1 also has one Medium authority-guard omission and Low
cleanup findings. V1 must not be fast-forwarded into V2 even if that audit is
closed: its local `Requirement` plus remote `WorkflowInstance` transaction shape
is the architecture V2 is removing.

Classification below applies to the V1 diff itself. `REUSE` means selective
copy/rewrite into V2, not merge of the candidate.

| V1 file | Classification | Decision |
| --- | --- | --- |
| `.env.example` | `DISCARD` | V1 cohort/outbox flags describe the dual-write bridge; V2 gets a smaller config surface. |
| `backend/package.json` | `DISCARD` | V1 relay and DB-binding scripts do not belong to the V2 runtime. |
| `backend/prisma/migrations/20260716090000_add_svc_workflow_cutover_foundation/migration.sql` | `DISCARD` | Creates local Run, Outbox, Artifact, and projection authority structures forbidden for new V2 items. |
| `backend/prisma/schema.prisma` | `DISCARD` | Same dual-authority model; V2 starts with no new business-authority table. |
| `backend/src/config/env.ts` | `DISCARD` | Replace cohort/relay settings with V2 service URL, binding config, and test-only token provider. |
| `backend/src/routes/reports.ts` | `TEMPORARY_BRIDGE` | Authority guard idea may help freeze legacy writes; the Report domain and route do not enter V2. |
| `backend/src/routes/requirements/audit-summary.ts` | `DISCARD` | Local Requirement projection read. |
| `backend/src/routes/requirements/core-create.ts` | `DISCARD` | Creates local Requirement before remote instance. |
| `backend/src/routes/requirements/core-kanban.ts` | `DISCARD` | Local Requirement list/projection. |
| `backend/src/routes/requirements/core-lifecycle.ts` | `TEMPORARY_BRIDGE` | Only useful to freeze legacy writes during per-item authority transfer. |
| `backend/src/routes/requirements/core-list.ts` | `DISCARD` | Local Requirement list/projection. |
| `backend/src/routes/requirements/core-mine.ts` | `DISCARD` | Local role/step worklist logic must be replaced by SVC queries. |
| `backend/src/routes/requirements/core-patch.ts` | `TEMPORARY_BRIDGE` | Legacy freeze guard only; V2 does not patch local workflow state. |
| `backend/src/routes/requirements/core-put.ts` | `TEMPORARY_BRIDGE` | Legacy freeze guard only. |
| `backend/src/routes/requirements/core-requested.ts` | `DISCARD` | Local Requirement list/projection. |
| `backend/src/routes/requirements/dependency-graph.ts` | `DISCARD` | Project/dependency domain is outside V2. |
| `backend/src/routes/requirements/events.ts` | `DISCARD` | Merges local and SVC events and therefore preserves dual history semantics. |
| `backend/src/routes/requirements/requirement-selects.ts` | `DISCARD` | Local Requirement serializer/projection. |
| `backend/src/routes/requirements/review.ts` | `TEMPORARY_BRIDGE` | Legacy freeze guard only; Review becomes a structured SVC submission. |
| `backend/src/routes/requirements/transitions.ts` | `TEMPORARY_BRIDGE` | Legacy history can remain read-only, but the local transition model does not enter V2. |
| `backend/src/routes/requirements/utils.ts` | `DISCARD` | Local workflow status and action derivation. |
| `backend/src/routes/requirements/workflow-advance.ts` | `TEMPORARY_BRIDGE` | Can block/reroute a V1 cohort, but V2 calls SVC transition directly. |
| `backend/src/routes/requirements/workflow-assign.ts` | `TEMPORARY_BRIDGE` | Legacy freeze guard only; SVC owns assignment. |
| `backend/src/routes/requirements/workflow-lifecycle.ts` | `TEMPORARY_BRIDGE` | Legacy freeze guard only. |
| `backend/src/routes/requirements/workflow-mystep.ts` | `TEMPORARY_BRIDGE` | Legacy rejection guard only; V2 worklist is SVC-owned. |
| `backend/src/routes/requirements/workflow-reject.ts` | `TEMPORARY_BRIDGE` | Legacy freeze guard only; V2 sends `RETURN`. |
| `backend/src/routes/requirements/workflow-test-env.ts` | `TEMPORARY_BRIDGE` | Legacy queue isolation only; TestEnvLock is not a V2 model. |
| `backend/src/routes/requirements/workflow-wip.ts` | `TEMPORARY_BRIDGE` | Legacy WIP query only. |
| `backend/src/routes/tasks.ts` | `TEMPORARY_BRIDGE` | Guard may freeze Task-triggered workflow writes; Task does not enter V2. |
| `backend/src/scripts/relay-workflow-outbox-once.ts` | `DISCARD` | V2 new items do not use the V1 Outbox. |
| `backend/src/scripts/upsert-workflow-definition-binding.ts` | `REUSE_AS_MIGRATION_TOOLING` | Keep mapping-validation ideas; V2 binding should first be controlled config, not a local DB table. |
| `backend/src/server.ts` | `DISCARD` | V1 starts relay/reconciliation jobs; V2 runtime must not. |
| `backend/src/services/workflow-integration/authority.test.ts` | `TEMPORARY_BRIDGE` | Preserve the fail-closed test idea for legacy cutover, not its local authority enum as V2 domain. |
| `backend/src/services/workflow-integration/authority.ts` | `TEMPORARY_BRIDGE` | Per-item legacy freeze helper only. |
| `backend/src/services/workflow-integration/canonical-json.test.ts` | `REUSE_AS_MIGRATION_TOOLING` | Useful for deterministic legacy `sourceHash`. |
| `backend/src/services/workflow-integration/canonical-json.ts` | `REUSE_AS_MIGRATION_TOOLING` | Useful for MigrationLedger/source hash; not required for normal V2 create. |
| `backend/src/services/workflow-integration/create-cohort.test.ts` | `DISCARD` | Tests the local Requirement plus Outbox transaction. |
| `backend/src/services/workflow-integration/create-cohort.ts` | `DISCARD` | Implements the dual-write bridge. |
| `backend/src/services/workflow-integration/draft-advance.ts` | `DISCARD` | Builds local ArtifactRevision and Outbox around a mutable Requirement snapshot. |
| `backend/src/services/workflow-integration/gateway.ts` | `REUSE_IN_V2` | Reuse the narrow gateway boundary and 100-event limit; extend only for approved SVC APIs. |
| `backend/src/services/workflow-integration/outbox-relay.test.ts` | `DISCARD` | Tests a V1-only relay. |
| `backend/src/services/workflow-integration/outbox-relay.ts` | `DISCARD` | V1 dual-write durability mechanism. |
| `backend/src/services/workflow-integration/outbox-types.ts` | `DISCARD` | V1 dual-write command types. |
| `backend/src/services/workflow-integration/reconciliation.ts` | `REUSE_AS_MIGRATION_TOOLING` | Reuse compare/repair ideas only for MigrationLedger reconciliation, never as V2 command input. |
| `backend/src/services/workflow-integration/workflow-cutover-postgres.integration.test.ts` | `REUSE_AS_MIGRATION_TOOLING` | Reuse failure/idempotency experiment patterns; replace V1 DB assertions with direct-instance assertions. |
| `backend/src/utils/status.ts` | `DISCARD` | Derives local status from local steps. |
| `docs/ADC_SVC_WORKFLOW_CUTOVER_V1.md` | `REUSE_AS_MIGRATION_TOOLING` | Retain as V1 evidence and rollback lessons, not V2 architecture. |

The most reusable implementation is already on ADC `develop`, outside the V1
diff: `backend/src/clients/svc-workflow/`. It has typed Create, Detail,
Transition, Timeline, strict wire validation, retries, error mapping, and
idempotency handling. V2 will reuse this code before considering a shared package.

## 4. Legacy ADC size and data evidence

### Static production code inventory

All counts use tracked source on ADC `develop@939a93e` and exclude tests,
`node_modules`, and generated `dist` files.

| Metric | Baseline |
| --- | ---: |
| Prisma models | 32 |
| Mounted Express route method definitions | 179 across 57 route files |
| Auto-mounted top-level/subdirectory route modules | 27 |
| Frontend `*Page.tsx` components | 25 |
| `App.tsx` path declarations | 55, including duplicated public/protected paths |
| Backend production TypeScript LOC | 19,885 |
| Frontend production TypeScript/TSX LOC | 12,694 |
| Backend route LOC | 12,986 |
| Frontend page LOC | 8,748 |

The production Dockerfile builds `backend/`; the duplicate root `src/` tree is
not counted as the deployed backend. Three backend route files contain 14 dead
method definitions that are neither mounted nor invoked:
`routes/services.ts`, `requirements/core-crud.ts`, and
`requirements/workflow-submit.ts`. The 179 figure excludes them. Of the mounted
surface, 72 method definitions belong directly to Requirement, Report, Task,
Project, Postmortem, and Comment code. The React router has 29 unique paths; the
55 declarations come from public/protected duplication. The miniprogram adds
eight page directories, six of which directly expose legacy Requirement, Task,
or Report UX.

### Local database snapshot

The only reachable database was loopback PostgreSQL database
`agent_dev_center`. Queries were read-only. It is not proven to be production:
production compose files name an internal Docker host, no local production
container is running, deployment documentation contains a redacted host, and no
local backup was found.

| Metric | Local snapshot |
| --- | ---: |
| Public base tables | 36 including `_prisma_migrations` |
| Requirements | 131 |
| Active: non-terminal, non-null `currentStep` | 35 |
| Completed by `done` or `archived` | 0 |
| Abandoned | 0 |
| Abnormal/uninitialized: null `currentStep` | 96 |
| All rows stale over 48 hours / 7 days / 30 days | 131 / 131 / 0 |
| Active rows stale over 7 days | 35 |
| Reports / WorkflowTransitions / Revisions | 30 / 15 / 5 |
| Tasks / Comments / Postmortems | 0 / 0 / 0 |
| WorkflowTemplates | 93 |

Step distribution is `NULL=96`, `cto_review=10`, `dev_self_check=10`,
`qa_pre_release=10`, `testing=5`; all 131 rows have `status=pending`. The oldest
create and newest update are both on 2026-07-01. This shape looks synthetic and
must not be used as a production migration denominator. The local database also
lacks `requirement_event_ledger` and `root_cause_candidates` although the current
Prisma schema declares them. Conversely it contains `business_domains`,
`domain_role_bindings`, `machine_clients`, `machine_principals`, and
`service_registrations`, which the current Prisma schema does not declare. This
is direct schema-drift evidence.

All 35 active rows have a workflow snapshot and a `currentStep` found in that
snapshot, but all 35 have null `workflowId` and null `assigneeId`; 20 also lack
the legacy assignee display string. They are candidates for mapping analysis,
not import-ready rows. At least those 20 require explicit principal recovery or
manual disposition.

Production Requirement counts remain `NOT_VERIFIED`. Obtaining them requires a
read-only production connection or a sanitized backup supplied through the
production operations boundary; Stage 0 did not request or expose a secret.

### Running and schedulable legacy jobs

- backend startup calls `ensureWorkflowTemplates()` and seeds marketplace agents;
- backend runs `runOverdueCheck()` after 30 seconds and hourly thereafter;
- workflow advance can call the in-process `autoAdvanceTestEnvQueue()`;
- `scripts/qa-review-poll.sh` is designed for a 30-minute cron;
- `scripts/crontab-example.conf` defines five active old Task pollers plus five
  commented examples;
- health, backup, account-check, and deploy scripts are operational concerns that
  must move out of ADC, not V2 business jobs.

No local ADC server, Docker daemon, or listed cron process was running during
this audit. Repository presence does not prove the scripts are scheduled in
production.

## 5. External callers and security finding

Confirmed tracked callers outside ADC:

1. `/Users/yanfenma/workspace/project/deploy-agent/sim.py` directly calls old ADC
   Requirement create, workflow assign/advance, Report create/QA review, and
   Requirement patch endpoints. `sim.sh` is part of the same simulator surface.
2. `/Users/yanfenma/workspace/project/svc-okr/src/routes/reports/weekly.ts` reads
   `GET /api/requirements?page=1&pageSize=200` at runtime and derives completed
   work from legacy `currentStep`.
3. ADC's own poll and QA scripts consume old Task, Report, and Requirement APIs.

High security finding: `deploy-agent` tracks plaintext account credentials in
`sim.sh`/`sim.py`, a bearer in `exec-payload.json`, and deployment-key material in
`exec-call-payload.json`/`decode-nginx.py`. Values were not reproduced in this
report. The JWT appeared expired, but the deployment key's revocation state is
unknown. Those credentials must be treated as compromised until independently
rotated/revoked. This finding blocks claiming that old write clients are
retired; it does not authorize editing the deploy-agent repository or rotating
production credentials from this stage.

## 6. Current `svc-workflow` capability matrix

| ADC V2 need | Current local `svc-workflow@4a7b3a3` | Decision |
| --- | --- | --- |
| Create | HTTP API exists; idempotent; needs configured `domainId` and `definitionVersionId` | Directly reusable with controlled binding config. |
| Detail | HTTP API exists for known instance ID | Directly reusable. No external-reference lookup. |
| Timeline | HTTP API exists for SVC events | Directly reusable for post-create/import history. Legacy archive remains separate. |
| Action | HTTP transition API exists for ADVANCE/RETURN/TERMINATE | Directly reusable when no Context revision is needed. |
| Worklist | `ListAssignedToMe` and `ListCreatorOwnedDrafts` Rust query services exist and 5 focused tests pass | **No network API. Stage 1 hard stop.** |
| DRAFT Context edit plus transition | Application service exists | No network API. Not needed for a create-then-transition first slice; required before editable Draft UX. |
| Legacy initial import | Application service with 31 focused tests | **No HTTP/gRPC/CLI. Stage 4 hard stop.** |
| Identity provisioning | HTTP API exists locally | Production provisioning remains outside this task and needs formal auth/secret authorization. |

Legacy Import can truthfully create an active or terminal instance at a fixed
Definition node and exact resolver-derived assignee. It creates Context #1,
Visit #1, Import Event #1, and SVC state version 1. It does not import old visits,
transitions, reports, submissions, event times, or legacy version continuity.
The legacy snapshot participates in a deterministic digest/request hash, but the
full snapshot is not queryable from SVC. A fixed `:v1` idempotency key also means
a later-changed source snapshot conflicts rather than updating the imported
instance.

Therefore:

- pre-import legacy history stays in `LegacyArchive` with confidence markers;
- an active row must be frozen before import and reconciled before authority
  changes from `MIGRATING` to `SVC`;
- null/unknown step, resolver-assignee mismatch, or unmapped principal is a
  per-row migration failure, never an invented event or assignee;
- production migration cannot use the current process-internal import service.

## 7. Auth boundary

Local Stage 1 smoke is conditionally possible from the fixed auth object
`3af27e7/b70429` with a temporary PostgreSQL database, temporary RSA key, and
temporary Agent identities. A harness may obtain Direct/OBO tokens and inject a
short-lived bearer into ADC without persisting or logging it.

The provisioning scope is now consistently `workflow.admin`; OBO provisioning
must be rejected. Human direct/OBO is not implemented, the audited OBO report is
untracked, remote main does not contain the local OBO object, and real key/client
provisioning is not authorized. Thus real-user Canary and production cutover are
`NO_GO` while local test-identity smoke is `CONDITIONAL_GO`.

## 8. Minimal V2 code shape

Stage 1 should be isolated inside the existing workspaces so it can reuse the
audited client and dependencies without importing legacy application state. It
gets a separate server entrypoint and route namespace; it must not import Prisma,
legacy route modules, startup seeders, or overdue jobs.

```text
backend/src/v2/
  app.ts
  server.ts
  config.ts
  auth/request-principal.ts
  definitions/bindings.ts
  routes/health.ts
  routes/definition-bindings.ts
  routes/workflows.ts
  routes/worklist.ts
  svc-workflow/gateway.ts

frontend/src/v2/
  V2App.tsx
  api/client.ts
  pages/WorklistPage.tsx
  pages/CreateWorkflowPage.tsx
  pages/WorkflowDetailPage.tsx
  components/CurrentVisit.tsx
  components/WorkflowTimeline.tsx
  components/WorkflowActions.tsx
```

The first V2 runtime has zero local business tables and zero background jobs.
Definition bindings are an immutable validated config array:

```text
scenarioKey -> domainId -> definitionVersionId -> definitionDigest
```

Minimal ADC-facing API:

| Method | Path | Authority behavior |
| --- | --- | --- |
| `GET` | `/api/v2/health` | Dependency readiness only. |
| `GET` | `/api/v2/definition-bindings` | Returns controlled scenarios, no SVC definition mutation. |
| `GET` | `/api/v2/worklist?kind=assigned|creator-drafts` | Pure SVC query proxy after the approved network adapter exists. |
| `POST` | `/api/v2/workflow-instances` | Resolve scenario binding, call SVC Create directly with caller idempotency key. |
| `GET` | `/api/v2/workflow-instances/:id` | Pure SVC Detail proxy. |
| `GET` | `/api/v2/workflow-instances/:id/timeline` | Pure SVC Timeline proxy. |
| `POST` | `/api/v2/workflow-instances/:id/transitions` | Pass selected executable transition, expected SVC state version, and submission. |

ADC never accepts actor/assignee/next-node fields from the body. Identity comes
from the verified token. The frontend renders only transitions returned as
`executableForActor=true`.

## 9. Hard stops before Stage 1 implementation

### HS-1: Worklist has no cross-process contract

Stage 1 requires Worklist, while the current SVC HTTP contract explicitly
excludes it. ADC must not query the SVC database, maintain a local Requirement
list, infer work from timelines, or label creator drafts as "waiting for others".

Recommended smallest first extension for discussion:

```text
GET /internal/v1/worklists/assigned-to-me
GET /internal/v1/worklists/creator-owned-drafts
scope: workflow.read
actor: JWT sub only
pagination and DTO: exact existing Workflow Query Contract v0.1
implementation: HTTP adapter -> existing WorkflowInstanceQueryService
no schema, kernel, event, receipt, command, or storage change
```

This yields a usable first Worklist with "我需要处理" and "我的草稿". It does
not falsely claim the final "等待其他人" or "已完成" views. Those require a
separate principal-history query design after the direct slice is in use.

### HS-2: Legacy Import has no cross-process contract

This blocks Stage 4, not creation of new V2 instances. The eventual design must
add a controlled import adapter or tool around the existing application service,
plus freeze/source-hash/reconciliation semantics. It must be discussed separately
before any `svc-workflow` change.

### HS-3: old callers and credential material

New V2 development can proceed, but old write routes cannot be retired or made
read-only until `deploy-agent` usage is classified and its tracked credentials
are revoked/removed by an authorized owner. `svc-okr` needs a replacement SVC
query/decision-dataset contract before the Requirement list endpoint is deleted.

### HS-4: production data denominator is unknown

This blocks a production migration batch plan and active-row count, not the
isolated Stage 1 slice. A sanitized backup or authorized read-only production
count is required before Stage 4/5 gates.

## 10. Stage disposition

Stage 0 is complete and frozen. Stage 1 is ready to implement Create, Detail,
Timeline, Action, binding config, and the no-DB V2 shell, but its Worklist gate
requires explicit agreement on the two read-only SVC HTTP adapters above.

No `svc-workflow` implementation starts until that design is agreed. Legacy
Import network design, complete four-bucket Worklist design, real auth, credential
rotation, production counts, and production cutover remain later hard gates.
