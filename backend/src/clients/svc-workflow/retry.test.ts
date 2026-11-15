import { describe, expect, it, vi } from 'vitest';
import { WorkflowClient } from './client.js';
import { WorkflowApiError, WorkflowTransportError } from './errors.js';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const DOMAIN_ID = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const CONTEXT_ID = '55555555-5555-4555-8555-555555555555';
const VISIT_ID = '66666666-6666-4666-8666-666666666666';

function success(): Response {
  return new Response(
    JSON.stringify({
      workflowInstanceId: INSTANCE_ID,
      workflowStateVersion: 1,
      currentContextRevisionId: CONTEXT_ID,
      currentNodeVisitId: VISIT_ID,
      eventSequence: 1,
    }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  );
}

function apiError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createInput() {
  return {
    domainId: DOMAIN_ID,
    definitionVersionId: DEFINITION_ID,
    metadata: { opaque_key: 'opaque-value' },
    contextPayload: { title: 'retry-test' },
  };
}

describe('WorkflowClient retry contract', () => {
  it.each([
    [503, 'service_unavailable'],
    [425, 'command_still_processing'],
    [408, 'request_timeout'],
  ])('retries HTTP %s/%s with the exact same token, body, and key', async (status, code) => {
    const tokenProvider = vi.fn(() => 'stable.machine.token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiError(status, code))
      .mockResolvedValueOnce(success());
    const sleep = vi.fn(async () => undefined);
    const client = new WorkflowClient(
      {
        baseUrl: 'http://127.0.0.1:8989',
        accessTokenProvider: tokenProvider,
        maxAttempts: 3,
      },
      { fetch: fetchMock, sleep },
    );

    await expect(
      client.create(createInput(), { idempotencyKey: 'stable-idempotency-key' }),
    ).resolves.toMatchObject({ workflowInstanceId: INSTANCE_ID });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tokenProvider).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(250);
    const first = fetchMock.mock.calls[0][1] as RequestInit;
    const second = fetchMock.mock.calls[1][1] as RequestInit;
    expect(second.body).toBe(first.body);
    expect(second.headers).toEqual(first.headers);
    expect(first.headers).toMatchObject({
      Authorization: 'Bearer stable.machine.token',
      'Idempotency-Key': 'stable-idempotency-key',
    });
  });

  it('retries an opaque 503 response but reports protocol failure if all attempts stay malformed', async () => {
    const fetchMock = vi.fn(async () => new Response('proxy unavailable', { status: 503 }));
    const client = new WorkflowClient(
      {
        baseUrl: 'http://127.0.0.1:8989',
        accessTokenProvider: () => 'stable.machine.token',
        maxAttempts: 3,
      },
      { fetch: fetchMock, sleep: async () => undefined },
    );

    await expect(
      client.create(createInput(), { idempotencyKey: 'stable-key' }),
    ).rejects.toMatchObject({ kind: 'protocol', attempts: 3, status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    [400, 'invalid_json'],
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [404, 'workflow_instance_not_found_or_not_visible'],
    [408, 'other_timeout'],
    [413, 'size_limit_exceeded'],
    [422, 'invalid_pagination'],
    [425, 'other_too_early'],
    [409, 'workflow_state_version_conflict'],
    [429, 'rate_limited'],
    [500, 'internal_consistency_error'],
  ])('does not retry HTTP %s/%s', async (status, code) => {
    const fetchMock = vi.fn(async () => apiError(status, code));
    const client = new WorkflowClient(
      {
        baseUrl: 'http://127.0.0.1:8989',
        accessTokenProvider: () => 'stable.machine.token',
        maxAttempts: 3,
      },
      { fetch: fetchMock, sleep: async () => undefined },
    );

    await expect(
      client.create(createInput(), { idempotencyKey: 'stable-key' }),
    ).rejects.toMatchObject<Partial<WorkflowApiError>>({ kind: 'api', status, code, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a network failure and resolves the token only once', async () => {
    const tokenProvider = vi.fn(() => 'stable.machine.token');
    const logs: unknown[] = [];
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection reset at secret URL'))
      .mockResolvedValueOnce(success());
    const client = new WorkflowClient(
      {
        baseUrl: 'http://127.0.0.1:8989',
        accessTokenProvider: tokenProvider,
        maxAttempts: 2,
      },
      {
        fetch: fetchMock,
        sleep: async () => undefined,
        logger: { log: (event) => logs.push(event) },
      },
    );

    await client.create(createInput(), { idempotencyKey: 'stable-key' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tokenProvider).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logs)).not.toContain('secret URL');
    expect(JSON.stringify(logs)).not.toContain('stable.machine.token');
  });

  it('retries an actual client-side AbortSignal timeout', async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      attempt += 1;
      if (attempt === 2) return success();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    });
    const client = new WorkflowClient(
      {
        baseUrl: 'http://127.0.0.1:8989',
        accessTokenProvider: () => 'stable.machine.token',
        requestTimeoutMs: 1,
        maxAttempts: 2,
      },
      { fetch: fetchMock, sleep: async () => undefined },
    );

    await expect(
      client.create(createInput(), { idempotencyKey: 'stable-key' }),
    ).resolves.toMatchObject({ workflowInstanceId: INSTANCE_ID });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns a typed transport error after network attempts are exhausted', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('network down');
    });
    const client = new WorkflowClient(
      {
        baseUrl: 'http://127.0.0.1:8989',
        accessTokenProvider: () => 'stable.machine.token',
        maxAttempts: 3,
      },
      { fetch: fetchMock, sleep: async () => undefined },
    );

    const promise = client.create(createInput(), { idempotencyKey: 'stable-key' });
    await expect(promise).rejects.toMatchObject<Partial<WorkflowTransportError>>({
      kind: 'transport',
      transport: 'network',
      attempts: 3,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
