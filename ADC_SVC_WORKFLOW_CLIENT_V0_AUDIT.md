# ADC_SVC_WORKFLOW_CLIENT_V0 Independent Audit

```text
Status: PASS
Stage: ADC_CLIENT_SMOKE_READY
Audit date: 2026-07-16
Mode: independent implementation review followed by a report-only commit
Repository: /Users/yanfenma/workspace/project/agent-dev-center
Branch: codex/adc-svc-workflow-client-v0
Base: fc455f91d2b2a0fee49aaaa4874fbf9e8741c3e1
Audited head: 3130c87160085fd540bda9010e8937a759e01df0
Upstream svc-workflow contract head: f3306a5d387aa4159a995b7477e4c9da1a7193b7
```

## Verdict

The isolated ADC `WorkflowClient` satisfies the frozen Stage 1B client contract.

```text
Blocker: 0
High:    0
Medium:  0
```

The branch may be treated as `ADC_CLIENT_SMOKE_READY`. This verdict means the reusable client and
isolated smoke runner are ready for a provisioned live smoke. It does not claim that a live smoke
has run, that a production actor model has been frozen, or that any ADC production write path has
cut over.

## Audit scope

The independent review covered:

- the single reusable client boundary and its isolation from ADC production code;
- `/version` and `/readyz` preflight plus create, detail, transition, and timeline operations;
- compatibility with the final `svc-workflow` HTTP wire format at `f3306a5`;
- actor provenance, access-token acquisition, request bodies, and headers;
- idempotency-key validation and request stability across retry attempts;
- the exact retry allowlist and non-retry behavior;
- typed errors, response protocol validation, and log redaction;
- smoke-only environment evaluation and explicit isolation confirmation;
- production Route, Service, Job, Prisma, and write-path reference scans;
- file-size, directory-child, directory-depth, diff-hygiene, and workspace-state constraints;
- targeted tests, root typecheck/build, and the pre-existing full-suite baseline failures.

## Boundary and production isolation

`backend/src/clients/svc-workflow/client.ts` is the only implementation of the HTTP client. Its
ordinary public barrel exports the client, contracts, and typed errors only:

```text
backend/src/clients/svc-workflow/index.ts
```

The smoke environment adapter is deliberately absent from that barrel. Only the isolated runner
imports it directly:

```text
backend/src/scripts/svc-workflow-client-smoke.ts
  -> backend/src/clients/svc-workflow/config.ts
```

Repository-wide scans found no `svc-workflow`, `SVC_WORKFLOW`, internal workflow URL, or
`WorkflowClient` reference in an ADC production Route, Service, Job, Prisma module, or existing
production write path. The candidate therefore adds no shadow call, dual write, database link, or
implicit production activation.

The environment schema parses optional smoke settings, but the reusable barrel does not import
the smoke adapter and no production path consumes those settings. The smoke factory additionally
requires this explicit gate before it will return a client:

```text
SVC_WORKFLOW_SMOKE_CONFIRM=isolated-test-only
```

## Endpoint and preflight contract

`WorkflowClient.assertSmokeReady()` performs unauthenticated preflight in fail-fast order:

```text
GET /version
GET /readyz
```

`/version` must identify `svc-workflow`, schema `0010`, and API contract `internal-v0`; `/readyz`
must return `status=ready`. Version drift stops before readiness or any business mutation.

The isolated smoke runner invokes all four frozen business operations after preflight:

```text
POST /internal/v1/workflow-instances
GET  /internal/v1/workflow-instances/{workflowInstanceId}
POST /internal/v1/workflow-instances/{workflowInstanceId}/transitions
GET  /internal/v1/workflow-instances/{workflowInstanceId}/timeline
```

It also proves create receipt replay with the same input and idempotency key, full detail
visibility, a transition, and a strictly increasing timeline.

## Final svc-workflow casing and opaque JSON

The client schemas were checked field by field against `svc-workflow` at `f3306a5`.

The upstream wire intentionally mixes casing:

- create and transition inputs and responses use camelCase;
- `/version` uses camelCase and `/readyz` uses `status`;
- detail response structural fields use snake_case;
- timeline items use snake_case while the wrapper cursor is `nextCursor`.

`backend/src/clients/svc-workflow/wire.ts` accepts those exact wire shapes and maps only known
structural fields to the ADC camelCase model. It does not recursively case-convert or otherwise
rewrite these opaque JSON values:

```text
metadata
contextPayload / current_context.payload
submissionPayload / submission_schema
event_data
error.details
```

Strict object schemas reject unknown structural fields, including actor-like request fields.

## Actor, token, and request integrity

The client has no JWT signing secret, actor option, principal header, or free-form caller header.
Authenticated operations obtain actor identity only from the bearer token returned by the
configured `AccessTokenProvider`.

For each logical request, the client resolves and validates that token once before entering the
attempt loop. The serialized body, Authorization header, idempotency key, URL, and method are also
constructed before the loop and reused across every attempt.

Create and transition inputs are strict and contain no `principalId`, `actorPrincipalId`, or other
actor injection field. The only actor-bearing request material is:

```text
Authorization: Bearer <AccessTokenProvider result>
```

The idempotency key must be 1 through 128 visible ASCII characters (`0x21..0x7e`). Empty,
whitespace-bearing, control-character, non-ASCII, and overlength values fail before token
acquisition or transport. The isolated smoke uses one stable key per logical create or transition
command.

## Retry contract

The implementation retries only:

```text
network transport failure
client-side request timeout
HTTP 503
HTTP 425 + error.code=command_still_processing
HTTP 408 + error.code=request_timeout
```

The maximum attempt count is constrained to 1 through 3. The default delays are 250 ms and 500
ms. The same token, serialized body, headers, and idempotency key are retained across attempts.

It does not retry auth failures, other 4xx responses, 409, 429, 500, a 425 with another code, or a
408 with another code. A malformed success response is a protocol failure without retry. An
opaque 503 is retried because status 503 is independently retryable, then reported as a protocol
failure if the final response still lacks the required envelope.

## Errors, protocol checks, and redaction

The public error boundary distinguishes:

```text
WorkflowConfigurationError
WorkflowTransportError  (network | timeout)
WorkflowApiError        (validated upstream envelope)
WorkflowProtocolError   (invalid upstream protocol)
```

Successful bodies, error envelopes, identifiers, query inputs, and preflight responses are
runtime-validated with strict schemas. Unparseable or structurally invalid upstream responses do
not leak through as successful domain objects.

Attempt logs contain only operation, attempt, duration, outcome, status, validated error code,
sanitized upstream request ID, and transport class. They exclude access tokens, Authorization,
idempotency keys, URLs, request bodies, upstream messages, and error details. Logger failures are
swallowed so observability cannot change command transport semantics. The smoke runner likewise
prints only typed classification metadata on failure.

## Verification evidence

The following commands were run against audited head `3130c87160085fd540bda9010e8937a759e01df0`:

```text
npm --workspace @agent-dev-center/backend test -- \
  src/clients/svc-workflow/client.test.ts \
  src/clients/svc-workflow/retry.test.ts \
  src/clients/svc-workflow/wire.test.ts
                                                    PASS: 3 files, 33/33 tests

npm run typecheck                                   PASS: backend + frontend
npm run build                                       PASS: backend + frontend
git diff --check fc455f9..3130c871                  PASS
```

The production frontend build emitted only its pre-existing large-chunk advisory; compilation
and bundle generation completed successfully.

### Full backend baseline

The full backend suite was also rerun:

```text
Test Files: 21 passed | 2 failed | 3 skipped
Tests:      350 passed | 15 failed | 27 skipped
```

The failures are the existing baseline only:

- all 15 failures are in `kernel-snapshot-helpers.test.ts`, whose expectations target legacy
  helper behavior no longer present;
- `reports-self-approval.test.ts` cannot import the already-absent
  `routes/reports-approval.js` module.

The candidate does not modify either failing test, the workflow helper they exercise, the absent
route family, or their import paths. Blob hashes for both failing tests and
`routes/requirements/workflow-helpers.ts` are identical at base and audited head. No newly added
client test failed.

## Live smoke status and real provisioning blockers

The mutating live smoke was intentionally not executed. A non-mutating configuration and endpoint
check found the actual local provisioning state:

```text
SVC_WORKFLOW_SMOKE_CONFIRM                  unset
SVC_WORKFLOW_SMOKE_ACCESS_TOKEN             unset
SVC_WORKFLOW_SMOKE_DOMAIN_ID                unset
SVC_WORKFLOW_SMOKE_DEFINITION_VERSION_ID    unset
SVC_WORKFLOW_SMOKE_TRANSITION_DEFINITION_ID unset
SVC_WORKFLOW_BASE_URL                       http://127.0.0.1:8989
GET /version                                unreachable
GET /readyz                                 unreachable
```

A real live smoke therefore still requires all of the following external provisioning:

1. a running isolated `svc-workflow` instance with the exact `0010` migration ledger;
2. a short-lived access token whose `JWT.sub` maps to the provisioned smoke Principal;
3. a Domain, published DefinitionVersion, and applicable TransitionDefinition visible to that
   Principal;
4. the five explicit smoke environment values above, including the isolation confirmation gate.

No shared JWT secret is requested or consumed by the ADC client. Provisioning a real production
delegation or on-behalf-of actor model remains a later architecture decision and is outside this
Stage 1B audit.

## Structural and workspace hygiene

All new handwritten files are below 500 lines; the largest implementation file is 416 lines. The
new client directory has 9 direct files, no candidate-created directory exceeds the 20-child
limit, and the new tree stays within the four-level depth limit.

The pre-existing untracked directory was preserved and is not part of this audit commit:

```text
?? .zcode/
```

No functional file, production route, production database, secret, deployment, push, tag, merge,
or live workflow instance was changed by this independent audit.

```text
ADC_SVC_WORKFLOW_CLIENT_V0_AUDIT_PASS
ADC_CLIENT_SMOKE_READY
```
