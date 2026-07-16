import { describe, expect, it, vi } from 'vitest';
import { WorkflowClient } from './client.js';
import {
  WorkflowApiError,
  WorkflowConfigurationError,
  WorkflowProtocolError,
} from './errors.js';
import type { WorkflowClientLogEvent } from './contracts.js';
import * as publicClientApi from './index.js';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const DOMAIN_ID = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const PRINCIPAL_ID = '44444444-4444-4444-8444-444444444444';
const CONTEXT_ID = '55555555-5555-4555-8555-555555555555';
const VISIT_ID = '66666666-6666-4666-8666-666666666666';
const NODE_ID = '77777777-7777-4777-8777-777777777777';
const TRANSITION_ID = '88888888-8888-4888-8888-888888888888';
const EVENT_ID = '99999999-9999-4999-8999-999999999999';

function jsonResponse(status: number, body: unknown, requestId = 'upstream-request'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
  });
}

function createResult() {
  return {
    workflowInstanceId: INSTANCE_ID,
    workflowStateVersion: 1,
    currentContextRevisionId: CONTEXT_ID,
    currentNodeVisitId: VISIT_ID,
    eventSequence: 1,
  };
}

function transitionResult() {
  return {
    workflowInstanceId: INSTANCE_ID,
    workflowStateVersion: 2,
    currentContextRevisionId: CONTEXT_ID,
    sourceNodeVisitId: VISIT_ID,
    currentNodeVisitId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    submissionId: null,
    eventSequence: 2,
  };
}

function historicalDetail() {
  return {
    visibility: 'historical_participant',
    detail: {
      instance: {
        workflow_instance_id: INSTANCE_ID,
        domain_id: DOMAIN_ID,
        definition_version_id: DEFINITION_ID,
        definition_version_status: 'PUBLISHED',
        workflow_state_version: 1,
        created_at: '2026-07-16T00:00:00Z',
        domain_enabled: true,
        is_terminal: false,
        current_node: {
          node_id: NODE_ID,
          node_key: 'draft',
          display_name: 'Draft',
          node_type: 'DRAFT',
        },
      },
    },
  };
}

function timelineResult() {
  return {
    items: [
      {
        event_id: EVENT_ID,
        workflow_instance_id: INSTANCE_ID,
        event_sequence: 1,
        event_schema_version: 'v1',
        command_id: null,
        causation_id: null,
        correlation_id: null,
        event_type: 'WORKFLOW_INSTANCE_CREATED',
        transition_effect: null,
        source_node_visit_id: null,
        target_node_visit_id: VISIT_ID,
        context_revision_id: CONTEXT_ID,
        submission_id: null,
        event_data: { keep_snake_key: true },
        event_data_digest: 'digest',
        actor_principal_id: PRINCIPAL_ID,
        from_node_id: null,
        to_node_id: NODE_ID,
        old_workflow_state_version: 0,
        new_workflow_state_version: 1,
        created_at: '2026-07-16T00:00:00Z',
      },
    ],
    nextCursor: null,
  };
}

describe('WorkflowClient endpoints', () => {
  it('keeps smoke env config out of the reusable client barrel', () => {
    expect(publicClientApi).not.toHaveProperty('createSmokeWorkflowClient');
    expect(publicClientApi).toHaveProperty('WorkflowClient');
  });

  it('preflights the exact API/schema versions and readiness without acquiring a token', async () => {
    const tokenProvider = vi.fn(() => 'unused-token');
    const fetchMock = vi.fn(async (input: string | URL) => {
      const path = new URL(input).pathname;
      if (path === '/version') {
        return jsonResponse(200, {
          service: 'svc-workflow',
          version: '0.3.1',
          gitSha: 'f3306a5',
          schemaVersion: '0010',
          apiContractVersion: 'internal-v0',
        });
      }
      return jsonResponse(200, { status: 'ready' });
    });
    const client = new WorkflowClient(
      { baseUrl: 'http://127.0.0.1:8989', accessTokenProvider: tokenProvider },
      { fetch: fetchMock },
    );

    await client.assertSmokeReady();

    expect(fetchMock.mock.calls.map(([input]) => new URL(input).pathname)).toEqual([
      '/version',
      '/readyz',
    ]);
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
    expect(tokenProvider).not.toHaveBeenCalled();
  });

  it('stops preflight before readyz when the API contract version drifts', async () => {
    const tokenProvider = vi.fn(() => 'unused-token');
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        service: 'svc-workflow',
        version: '0.3.1',
        gitSha: 'future',
        schemaVersion: '0010',
        apiContractVersion: 'internal-v1',
      }),
    );
    const client = new WorkflowClient(
      { baseUrl: 'http://127.0.0.1:8989', accessTokenProvider: tokenProvider },
      { fetch: fetchMock },
    );

    await expect(client.assertSmokeReady()).rejects.toBeInstanceOf(WorkflowProtocolError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tokenProvider).not.toHaveBeenCalled();
  });

  it('calls create, detail, transition, and timeline only through the client boundary', async () => {
    const tokenProvider = vi.fn(() => 'machine.jwt.token');
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/transitions')) return jsonResponse(200, transitionResult());
      if (url.pathname.endsWith('/timeline')) return jsonResponse(200, timelineResult());
      if (url.pathname === '/internal/v1/workflow-instances') return jsonResponse(201, createResult());
      return jsonResponse(200, historicalDetail());
    });
    const client = new WorkflowClient(
      { baseUrl: 'http://127.0.0.1:8989', accessTokenProvider: tokenProvider },
      { fetch: fetchMock },
    );

    const created = await client.create(
      {
        domainId: DOMAIN_ID,
        definitionVersionId: DEFINITION_ID,
        metadata: { source_key: 'opaque' },
        contextPayload: { business_key: 'opaque' },
      },
      { idempotencyKey: 'create-stable-key' },
    );
    const detail = await client.detail(INSTANCE_ID);
    const transitioned = await client.transition(
      INSTANCE_ID,
      { transitionDefinitionId: TRANSITION_ID, expectedWorkflowStateVersion: 1 },
      { idempotencyKey: 'transition-stable-key' },
    );
    const timeline = await client.timeline(INSTANCE_ID, { after: 0, limit: 50 });

    expect(created.workflowInstanceId).toBe(INSTANCE_ID);
    expect(detail.visibility).toBe('historical_participant');
    expect(transitioned.workflowStateVersion).toBe(2);
    expect(timeline.items[0].eventData).toEqual({ keep_snake_key: true });
    expect(tokenProvider).toHaveBeenCalledTimes(4);

    const calls = fetchMock.mock.calls;
    expect(new URL(calls[0][0]).pathname).toBe('/internal/v1/workflow-instances');
    expect(calls[0][1]?.method).toBe('POST');
    expect(calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer machine.jwt.token',
      'Idempotency-Key': 'create-stable-key',
    });
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({
      domainId: DOMAIN_ID,
      definitionVersionId: DEFINITION_ID,
      metadata: { source_key: 'opaque' },
      contextPayload: { business_key: 'opaque' },
    });
    expect(new URL(calls[1][0]).pathname).toBe(`/internal/v1/workflow-instances/${INSTANCE_ID}`);
    expect(calls[1][1]?.method).toBe('GET');
    expect(new URL(calls[2][0]).pathname).toBe(
      `/internal/v1/workflow-instances/${INSTANCE_ID}/transitions`,
    );
    expect(calls[2][1]?.headers).toMatchObject({ 'Idempotency-Key': 'transition-stable-key' });
    expect(new URL(calls[3][0]).searchParams.get('after')).toBe('0');
    expect(new URL(calls[3][0]).searchParams.get('limit')).toBe('50');
  });

  it('maps a valid remote envelope without logging response details', async () => {
    const logs: WorkflowClientLogEvent[] = [];
    const client = new WorkflowClient(
      { baseUrl: 'http://127.0.0.1:8989', accessTokenProvider: () => 'machine.jwt.token', maxAttempts: 1 },
      {
        fetch: async () =>
          jsonResponse(409, {
            error: {
              code: 'workflow_state_version_conflict',
              message: 'workflow state version does not match',
              details: { expected: 1, actual: 2, secret_payload: 'never-log' },
            },
          }),
        logger: { log: (event) => logs.push(event) },
      },
    );

    const promise = client.transition(
      INSTANCE_ID,
      { transitionDefinitionId: TRANSITION_ID, expectedWorkflowStateVersion: 1 },
      { idempotencyKey: 'do-not-log-this-key' },
    );
    await expect(promise).rejects.toMatchObject<Partial<WorkflowApiError>>({
      kind: 'api',
      status: 409,
      code: 'workflow_state_version_conflict',
      upstreamRequestId: 'upstream-request',
      attempts: 1,
    });
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain('machine.jwt.token');
    expect(serializedLogs).not.toContain('do-not-log-this-key');
    expect(serializedLogs).not.toContain('never-log');
    expect(serializedLogs).toContain('workflow_state_version_conflict');
  });

  it('rejects invalid input before token acquisition or transport', async () => {
    const tokenProvider = vi.fn(() => 'machine.jwt.token');
    const fetchMock = vi.fn(async () => jsonResponse(201, createResult()));
    const client = new WorkflowClient(
      { baseUrl: 'http://127.0.0.1:8989', accessTokenProvider: tokenProvider },
      { fetch: fetchMock },
    );

    await expect(
      client.create(
        {
          domainId: DOMAIN_ID,
          definitionVersionId: DEFINITION_ID,
          metadata: {},
          contextPayload: {},
          principalId: PRINCIPAL_ID,
        } as never,
        { idempotencyKey: 'valid-key' },
      ),
    ).rejects.toBeInstanceOf(WorkflowConfigurationError);
    await expect(
      client.create(
        { domainId: DOMAIN_ID, definitionVersionId: DEFINITION_ID, metadata: {}, contextPayload: {} },
        { idempotencyKey: 'contains whitespace' },
      ),
    ).rejects.toBeInstanceOf(WorkflowConfigurationError);
    expect(tokenProvider).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['', 'a'.repeat(129), 'non-ascii-é', 'line\nbreak'])(
    'rejects an invalid idempotency key without transport: %j',
    async (idempotencyKey) => {
      const tokenProvider = vi.fn(() => 'machine.jwt.token');
      const fetchMock = vi.fn(async () => jsonResponse(201, createResult()));
      const client = new WorkflowClient(
        { baseUrl: 'http://127.0.0.1:8989', accessTokenProvider: tokenProvider },
        { fetch: fetchMock },
      );
      await expect(
        client.create(
          { domainId: DOMAIN_ID, definitionVersionId: DEFINITION_ID, metadata: {}, contextPayload: {} },
          { idempotencyKey },
        ),
      ).rejects.toBeInstanceOf(WorkflowConfigurationError);
      expect(tokenProvider).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid success and error response protocols without retrying', async () => {
    const successFetch = vi.fn(async () => jsonResponse(200, { workflowInstanceId: INSTANCE_ID }));
    const client = new WorkflowClient(
      { baseUrl: 'http://127.0.0.1:8989', accessTokenProvider: () => 'machine.jwt.token' },
      { fetch: successFetch },
    );
    await expect(client.detail(INSTANCE_ID)).rejects.toBeInstanceOf(WorkflowProtocolError);
    expect(successFetch).toHaveBeenCalledTimes(1);

    const errorFetch = vi.fn(async () => new Response('<html>bad gateway</html>', { status: 500 }));
    const secondClient = new WorkflowClient(
      { baseUrl: 'http://127.0.0.1:8989', accessTokenProvider: () => 'machine.jwt.token' },
      { fetch: errorFetch },
    );
    await expect(secondClient.detail(INSTANCE_ID)).rejects.toBeInstanceOf(WorkflowProtocolError);
    expect(errorFetch).toHaveBeenCalledTimes(1);
  });
});
