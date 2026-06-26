/**
 * Route-level tests for core-patch.ts — PATCH /:id branch & repoPath
 *
 * Tests execute through the real Express routing stack:
 *   app/router → auth middleware → validation → core-patch handler → mocked Prisma → serializer
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const UUID = '00000000-0000-0000-0000-000000000001';
const OTHR = '00000000-0000-0000-0000-000000000099';

const { mockFindUnique, mockUpdate, mockFindFirst, mockUserFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUserFindUnique: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    requirement: { findUnique: mockFindUnique, update: mockUpdate },
    user: { findUnique: mockUserFindUnique, findFirst: mockFindFirst },
    workflowTemplate: { findFirst: mockFindFirst },
    notification: { create: vi.fn().mockResolvedValue({}) },
    workflowTransition: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { registerCorePatchRoutes } from '../routes/requirements/core-patch.js';
import { errorHandler } from '../middleware/error-handler.js';

// ── Test fixtures ──────────────────────────────────────────────

const DEFAULT_REQUIREMENT = {
  id: UUID, title: 'T', description: 'D', priority: 'P2', type: 'FEATURE',
  requester: 'r', department: 'e', workflowId: 'wf-1', currentStep: 'draft',
  assignee: null, assigneeId: null, requesterId: UUID, stateVersion: 0,
  gitHash: null, deployVersion: null, branch: null, repoPath: null,
  workflow: { steps: [] },
};

const DEFAULT_ADMIN_USER = { id: UUID, name: 'Admin', email: 'admin@test.com', role: 'admin' as const };

// ── Express app factory ─────────────────────────────────────────

function createApp(user?: Record<string, unknown>): express.Express {
  const app = express();
  app.use(express.json());

  // Auth middleware — sets req.user before route handler
  app.use((req: any, _res: express.Response, next: express.NextFunction) => {
    req.user = user ?? DEFAULT_ADMIN_USER;
    next();
  });

  const router = express.Router();
  registerCorePatchRoutes(router);
  app.use('/api/requirements', router);

  // Error handler so ZodError → 400, HttpError → correct status code
  app.use(errorHandler);

  return app;
}

// ── HTTP request helper ────────────────────────────────────────

interface PatchResult { status: number; body: unknown; }

async function patchRequest(app: express.Express, body: unknown): Promise<PatchResult> {
  const server = app.listen(0);
  await new Promise<void>(resolve => server.on('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  const postData = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      path: `/api/requirements/${UUID}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        server.close();
        let parsed: unknown;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode ?? 500, body: parsed });
      });
    });
    req.on('error', (err) => { server.close(); reject(err); });
    req.write(postData);
    req.end();
  });
}

// ── Prisma mock capture ────────────────────────────────────────

let capturedUpdateData: Record<string, unknown> | null = null;

function setupDefaultMock() {
  capturedUpdateData = null;
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
  mockFindFirst.mockReset();
  mockUserFindUnique.mockReset();

  mockFindUnique.mockResolvedValue(DEFAULT_REQUIREMENT);
  mockUpdate.mockImplementation(async (args: any) => {
    capturedUpdateData = (args && args.data) ? args.data : (args || {});
    return {
      ...DEFAULT_REQUIREMENT,
      ...capturedUpdateData,
      tasks: [],
      assigneeUser: null,
      project: null,
    };
  });
}

// ── Tests ──────────────────────────────────────────────────────

describe('PATCH /:id — branch & repoPath (route-level)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes branch + repoPath + gitHash together', async () => {
    setupDefaultMock();
    const app = createApp();

    const res = await patchRequest(app, { gitHash: 'abc123', branch: 'main', repoPath: 'agent-dev-center' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      gitHash: 'abc123',
      branch: 'main',
      repoPath: 'agent-dev-center',
    }));
    expect(capturedUpdateData).toEqual(expect.objectContaining({
      gitHash: 'abc123',
      branch: 'main',
      repoPath: 'agent-dev-center',
    }));
  });

  it('writes branch only', async () => {
    setupDefaultMock();
    const app = createApp();

    const res = await patchRequest(app, { branch: 'feature/x' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ branch: 'feature/x' }));
    expect(capturedUpdateData).toEqual(expect.objectContaining({ branch: 'feature/x' }));
    // Response body includes null for DB-default fields not in update
    expect((res.body as any).repoPath).toBeNull();
    // Prisma update data must NOT include repoPath
    expect(capturedUpdateData!.repoPath).toBeUndefined();
  });

  it('writes repoPath only', async () => {
    setupDefaultMock();
    const app = createApp();

    const res = await patchRequest(app, { repoPath: '/my/repo' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ repoPath: '/my/repo' }));
    expect(capturedUpdateData).toEqual(expect.objectContaining({ repoPath: '/my/repo' }));
    expect((res.body as any).branch).toBeNull();
    expect(capturedUpdateData!.branch).toBeUndefined();
  });

  it('omits branch/repoPath from update when not provided', async () => {
    setupDefaultMock();
    const app = createApp();

    const res = await patchRequest(app, {});

    expect(res.status).toBe(200);
    expect((res.body as any).branch).toBeNull();
    expect((res.body as any).repoPath).toBeNull();
    expect(capturedUpdateData!.branch).toBeUndefined();
    expect(capturedUpdateData!.repoPath).toBeUndefined();
  });

  it('accepts empty string branch (clearing semantics)', async () => {
    setupDefaultMock();
    const app = createApp();

    const res = await patchRequest(app, { branch: '' });

    expect(res.status).toBe(200);
    expect((res.body as any).branch).toBe('');
    expect(capturedUpdateData).toEqual(expect.objectContaining({ branch: '' }));
  });

  it('accepts empty string repoPath (clearing semantics)', async () => {
    setupDefaultMock();
    const app = createApp();

    const res = await patchRequest(app, { repoPath: '' });

    expect(res.status).toBe(200);
    expect((res.body as any).repoPath).toBe('');
    expect(capturedUpdateData).toEqual(expect.objectContaining({ repoPath: '' }));
  });

  it('rejects null branch with 400', async () => {
    setupDefaultMock();
    const app = createApp();

    const res = await patchRequest(app, { branch: null });

    expect(res.status).toBe(400);
  });

  it('response round-trip includes branch and repoPath', async () => {
    setupDefaultMock();
    const app = createApp();

    const res = await patchRequest(app, { branch: 'main', repoPath: '/r' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      branch: 'main',
      repoPath: '/r',
    }));
  });

  it('non-admin receives 403', async () => {
    setupDefaultMock();
    const nonAdmin = { id: 'diff-uuid-0000-0000-000000000099', name: 'Dev', email: 'dev@test.com', role: 'developer' as const, internalRole: 'developer' };
    const othersRequirement = {
      id: OTHR, title: 'T', description: 'D', priority: 'P2', type: 'FEATURE',
      requester: 'r', department: 'e', workflowId: null, currentStep: 'draft',
      assignee: null, assigneeId: OTHR, requesterId: UUID, stateVersion: 0,
      gitHash: null, deployVersion: null, branch: null, repoPath: null,
    };
    mockFindUnique.mockResolvedValue(othersRequirement);
    const app = createApp(nonAdmin as unknown as Record<string, unknown>);

    const res = await patchRequest(app, { repoPath: '/x' });

    expect(res.status).toBe(403);
  });

  it('assignee + branch together without regression', async () => {
    setupDefaultMock();
    mockFindFirst.mockResolvedValue({ id: UUID, name: 'Admin', internalRole: 'cto' });
    const app = createApp();

    const res = await patchRequest(app, { assignee: 'Admin', branch: 'main' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      assigneeId: UUID,
      assignee: 'Admin',
      branch: 'main',
    }));
  });
});
