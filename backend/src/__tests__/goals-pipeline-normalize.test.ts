/**
 * Pipeline Normalization Tests — Three layers:
 *
 *   1. Unit tests: normalizePipeline helper
 *   2. Prisma integration: direct create/update with normalized values
 *   3. HTTP integration: real Express → authRequired → requireOkrEdit → handler → Prisma
 *
 * Layer 3 tests use a real PostgreSQL test database, real JWT auth,
 * and real Express routing.  No mocks on Prisma or jwt.verify.
 *
 * ⚠ JWT_SECRET is injected via vi.hoisted() before any module is evaluated
 * so that config/env.ts picks up the test value rather than the default.
 */

import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const testSecret = vi.hoisted(() => 'test-jwt-secret-16-chars-here!');
const testDbUrl = vi.hoisted(() => {
  const url = process.env.KERNEL_TEST_DATABASE_URL || 'postgresql://yanfenma@localhost:5432/goals_pipeline_http_test?schema=public';
  process.env.DATABASE_URL = url;
  return url;
});

vi.mock('../config/env.js', () => ({
  env: {
    JWT_SECRET: testSecret,
    JWT_REFRESH_SECRET: testSecret,
    JWT_SECRET_SSO: testSecret,
    AUTH_JWT_SECRET: testSecret,
    AUTH_JWT_ISSUER: 'auth-service',
    AUTH_JWT_AUDIENCE: 'unified-platform',
    NODE_ENV: 'test',
    PORT: 4000,
    DATABASE_URL: 'postgresql://localhost:5432/test',
    JWT_EXPIRES_IN: '2h',
    JWT_REFRESH_EXPIRES_IN: '7d',
  },
}));
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

// ─── Test database ─────────────────────────────────────────

const integration = testDbUrl ? describe : describe.skip;
const IT_TIMEOUT = 30000;

// ─── Helper under test ─────────────────────────────────────

import { normalizePipeline } from '../routes/goals/permissions.js';

// ═══════════════════════════════════════════════════════════
// Layer 1 — Unit tests
// ═══════════════════════════════════════════════════════════

describe('normalizePipeline helper (unit)', () => {
  it('passes through "business"', () => {
    expect(normalizePipeline('business')).toBe('business');
  });

  it('passes through "content"', () => {
    expect(normalizePipeline('content')).toBe('content');
  });

  it('maps "cross-cutting" to "cross_cutting"', () => {
    expect(normalizePipeline('cross-cutting')).toBe('cross_cutting');
  });

  it('maps "cross_cutting" to "cross_cutting"', () => {
    expect(normalizePipeline('cross_cutting')).toBe('cross_cutting');
  });

  it('rejects non-string input', () => {
    expect(() => normalizePipeline(123)).toThrow();
  });

  it('rejects invalid pipeline value', () => {
    expect(() => normalizePipeline('invalid-pipeline')).toThrow();
    expect(() => normalizePipeline('')).toThrow();
  });

  it('rejects unknown pipeline value', () => {
    expect(() => normalizePipeline('some-random-value')).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════
// Layer 2 — Prisma integration (direct create/update)
// ═══════════════════════════════════════════════════════════

integration('pipeline normalization (direct Prisma)', () => {
  let pg: PrismaClient;
  let testAgentId: string;

  beforeAll(async () => {
    pg = new PrismaClient({ datasourceUrl: testDbUrl });
    await pg.$connect();

    const agent = await pg.marketplaceAgent.create({
      data: {
        name: `direct-prisma-agent-${Date.now()}`,
        displayName: 'Direct Prisma Test Agent',
        description: 'Temporary agent for Prisma integration tests',
      },
    });
    testAgentId = agent.id;
  });

  afterAll(async () => {
    if (pg) {
      await pg.goalRevision.deleteMany({ where: { goalCard: { agentId: testAgentId } } }).catch(() => {});
      await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } }).catch(() => {});
      await pg.marketplaceAgent.deleteMany({ where: { id: testAgentId } }).catch(() => {});
      await pg.$disconnect().catch(() => {});
    }
  });

  it('creates with "cross-cutting" (hyphen) — no PrismaClientValidationError', { timeout: IT_TIMEOUT }, async () => {
    const gc = await pg.agentGoalCard.create({
      data: {
        agentId: testAgentId,
        pipeline: normalizePipeline('cross-cutting'),
        longTermDirection: '[TEST] Prisma direct cross-cutting',
        monthlyGoals: [] as any,
        selfCheckCriteria: 'test',
        status: 'active',
      },
    });
    expect(gc.pipeline).toBe('cross_cutting');
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } });
  });

  it('creates with "cross_cutting" (underscore)', { timeout: IT_TIMEOUT }, async () => {
    const gc = await pg.agentGoalCard.create({
      data: {
        agentId: testAgentId,
        pipeline: normalizePipeline('cross_cutting'),
        longTermDirection: '[TEST] Prisma direct cross_cutting',
        monthlyGoals: [] as any,
        selfCheckCriteria: 'test',
        status: 'active',
      },
    });
    expect(gc.pipeline).toBe('cross_cutting');
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } });
  });

  it('creates with "business" pipeline', { timeout: IT_TIMEOUT }, async () => {
    const gc = await pg.agentGoalCard.create({
      data: {
        agentId: testAgentId,
        pipeline: normalizePipeline('business'),
        longTermDirection: '[TEST] Prisma direct business',
        monthlyGoals: [] as any,
        selfCheckCriteria: 'test',
        status: 'active',
      },
    });
    expect(gc.pipeline).toBe('business');
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } });
  });

  it('throws on invalid pipeline (direct Prisma with bad value)', { timeout: IT_TIMEOUT }, async () => {
    await expect(
      pg.agentGoalCard.create({
        data: {
          agentId: testAgentId,
          pipeline: 'invalid-pipeline' as any,
          longTermDirection: '[TEST] Should fail',
          monthlyGoals: [] as any,
          selfCheckCriteria: 'test',
          status: 'active',
        },
      })
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════
// Layer 3 — HTTP integration (real Express + real auth)
// ═══════════════════════════════════════════════════════════

integration('pipeline normalization (HTTP handler)', () => {
  let pg: PrismaClient;
  let testUser: { id: string; name: string; email: string };
  let testAgentId: string;
  let testToken: string;

  beforeAll(async () => {
    pg = new PrismaClient({ datasourceUrl: testDbUrl });
    await pg.$connect();

    const ts = String(Date.now());

    // Create a test user with admin role and okr_admin permission
    testUser = await pg.user.create({
      data: {
        id: crypto.randomUUID(),
        name: `http-test-${ts}`,
        email: `http-test-${ts}@local.dev`,
        role: 'admin',
        password: 'x',
        okrRole: 'okr_admin',
        enabled: true,
        mustChangePassword: false,
      },
      select: { id: true, name: true, email: true },
    });

    // Create a test marketplace agent
    const agent = await pg.marketplaceAgent.create({
      data: {
        name: `http-test-agent-${ts}`,
        displayName: 'HTTP Test Agent',
        description: 'Agent for HTTP pipeline normalization tests',
      },
    });
    testAgentId = agent.id;

    // Sign a real JWT that matches the authRequired middleware's expectations
    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = {
      sub: testUser.id,
      name: testUser.name,
      role: 'admin',
      okrRole: 'okr_admin',
      roles: ['adc:admin'],
      iss: 'agent-dev-center',
      aud: 'adc-api',
      jti: `${testUser.id}-${now}-test`,
      type: 'access',
      version: 'v1',
      iat: now,
      exp: now + 3600,
    };
    testToken = jwt.sign(tokenPayload, testSecret);
  });

  afterAll(async () => {
    if (pg) {
      await pg.goalRevision.deleteMany({ where: { goalCard: { agentId: testAgentId } } }).catch(() => {});
      await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } }).catch(() => {});
      await pg.marketplaceAgent.deleteMany({ where: { id: testAgentId } }).catch(() => {});
      await pg.user.deleteMany({ where: { id: testUser.id } }).catch(() => {});
      await pg.$disconnect().catch(() => {});
    }
  });

  // ── Express app with real goals routes ───────────────

  let goalsRouter: express.Router;
  let errorHandler: any;

  beforeAll(async () => {
    // Dynamic import so env is set before module evaluation
    const goalsModule = await import('../routes/goals/index.js');
    goalsRouter = goalsModule.goalsRouter;
    const errModule = await import('../middleware/error-handler.js');
    errorHandler = errModule.errorHandler;
  });

  function createGoalsApp(): express.Express {
    const app = express();
    app.use(express.json());
    app.use('/api/goals', goalsRouter);
    app.use(errorHandler);
    return app;
  }

  async function httpPost(path: string, body: unknown): Promise<{ status: number; body: any }> {
    const app = createGoalsApp();
    const server = app.listen(0);
    await new Promise<void>(r => server.on('listening', r));
    const port = (server.address() as AddressInfo).port;
    const data = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost', port, path, method: 'POST',
        headers: {
          'Authorization': `Bearer ${testToken}`,
          'Content-Type': 'application/json',
        },
      }, (res) => {
        let d = '';
        res.on('data', (c: string) => d += c);
        res.on('end', () => {
          server.close();
          let parsed: any;
          try { parsed = JSON.parse(d); } catch { parsed = d; }
          resolve({ status: res.statusCode ?? 500, body: parsed });
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  async function httpPut(path: string, body: unknown): Promise<{ status: number; body: any }> {
    const app = createGoalsApp();
    const server = app.listen(0);
    await new Promise<void>(r => server.on('listening', r));
    const port = (server.address() as AddressInfo).port;
    const data = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost', port, path, method: 'PUT',
        headers: {
          'Authorization': `Bearer ${testToken}`,
          'Content-Type': 'application/json',
        },
      }, (res) => {
        let d = '';
        res.on('data', (c: string) => d += c);
        res.on('end', () => {
          server.close();
          let parsed: any;
          try { parsed = JSON.parse(d); } catch { parsed = d; }
          resolve({ status: res.statusCode ?? 500, body: parsed });
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  // ── POST /api/goals tests ────────────────────────────

  it('POST business — HTTP 201', { timeout: IT_TIMEOUT }, async () => {
    const res = await httpPost('/api/goals', {
      agentId: testAgentId,
      pipeline: 'business',
      longTermDirection: '[HTTP] Business pipeline test',
      monthlyGoals: [],
      selfCheckCriteria: 'test',
    });
    expect(res.status).toBe(201);
    expect(res.body.goalCard).toBeDefined();
    expect(res.body.goalCard.pipeline).toBe('business');

    // Clean up
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } });
  });

  it('POST cross-cutting (hyphen) — HTTP 201, no 500', { timeout: IT_TIMEOUT }, async () => {
    const res = await httpPost('/api/goals', {
      agentId: testAgentId,
      pipeline: 'cross-cutting',
      longTermDirection: '[HTTP] cross-cutting test',
      monthlyGoals: [],
      selfCheckCriteria: 'test',
    });
    expect(res.status).toBe(201);
    expect(res.body.goalCard).toBeDefined();

    // Verify in DB it's stored as cross_cutting
    const gc = await pg.agentGoalCard.findUnique({ where: { agentId: testAgentId } });
    expect(gc?.pipeline).toBe('cross_cutting');

    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } });
  });

  it('POST cross_cutting (underscore) — HTTP 201', { timeout: IT_TIMEOUT }, async () => {
    const res = await httpPost('/api/goals', {
      agentId: testAgentId,
      pipeline: 'cross_cutting',
      longTermDirection: '[HTTP] cross_cutting test',
      monthlyGoals: [],
      selfCheckCriteria: 'test',
    });
    expect(res.status).toBe(201);
    expect(res.body.goalCard).toBeDefined();

    const gc = await pg.agentGoalCard.findUnique({ where: { agentId: testAgentId } });
    expect(gc?.pipeline).toBe('cross_cutting');

    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } });
  });

  it('POST invalid pipeline — HTTP 400, no DB write, no Prisma error in response', { timeout: IT_TIMEOUT }, async () => {
    // Ensure clean state
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } });
    const countBefore = await pg.agentGoalCard.count({ where: { agentId: testAgentId } });

    const res = await httpPost('/api/goals', {
      agentId: testAgentId,
      pipeline: 'invalid-pipeline',
      longTermDirection: '[HTTP] Should fail',
      monthlyGoals: [],
      selfCheckCriteria: 'test',
    });
    expect(res.status).toBe(400);

    // No new DB records
    const countAfter = await pg.agentGoalCard.count({ where: { agentId: testAgentId } });
    expect(countAfter).toBe(countBefore);

    // Response should NOT contain Prisma error text
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('PrismaClientValidationError');
    expect(bodyStr).not.toContain('Prisma');
  });

  // ── PUT /api/goals/:agentId tests ────────────────────
  // Each PUT test creates its own baseline goal card with 'business' pipeline.

  it('PUT cross-cutting — HTTP 200, DB pipeline = cross_cutting', { timeout: IT_TIMEOUT }, async () => {
    // Fresh baseline with 'business' pipeline
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } });
    await pg.agentGoalCard.create({
      data: {
        agentId: testAgentId,
        pipeline: 'business',
        longTermDirection: '[HTTP] PUT baseline',
        monthlyGoals: [] as any,
        selfCheckCriteria: 'test',
        status: 'active',
      },
    });

    const res = await httpPut(`/api/goals/${testAgentId}`, {
      pipeline: 'cross-cutting',
      changeNote: 'test update to cross-cutting',
    });
    expect(res.status).toBe(200);
    expect(res.body.goalCard).toBeDefined();

    const gc = await pg.agentGoalCard.findUnique({ where: { agentId: testAgentId } });
    expect(gc?.pipeline).toBe('cross_cutting');
  });

  it('PUT cross_cutting — HTTP 200, DB pipeline = cross_cutting', { timeout: IT_TIMEOUT }, async () => {
    // Fresh baseline
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } });
    await pg.agentGoalCard.create({
      data: {
        agentId: testAgentId,
        pipeline: 'business',
        longTermDirection: '[HTTP] PUT baseline 2',
        monthlyGoals: [] as any,
        selfCheckCriteria: 'test',
        status: 'active',
      },
    });

    const res = await httpPut(`/api/goals/${testAgentId}`, {
      pipeline: 'cross_cutting',
      changeNote: 'test update to cross_cutting',
    });
    expect(res.status).toBe(200);

    const gc = await pg.agentGoalCard.findUnique({ where: { agentId: testAgentId } });
    expect(gc?.pipeline).toBe('cross_cutting');
  });

  it('PUT invalid pipeline — HTTP 400, DB pipeline unchanged', { timeout: IT_TIMEOUT }, async () => {
    // Fresh baseline with 'business'
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } });
    await pg.agentGoalCard.create({
      data: {
        agentId: testAgentId,
        pipeline: 'business',
        longTermDirection: '[HTTP] PUT baseline invalid',
        monthlyGoals: [] as any,
        selfCheckCriteria: 'test',
        status: 'active',
      },
    });
    const before = await pg.agentGoalCard.findUnique({ where: { agentId: testAgentId } });
    expect(before?.pipeline).toBe('business');

    const res = await httpPut(`/api/goals/${testAgentId}`, {
      pipeline: 'invalid-pipeline',
    });
    expect(res.status).toBe(400);

    // DB value unchanged
    const after = await pg.agentGoalCard.findUnique({ where: { agentId: testAgentId } });
    expect(after?.pipeline).toBe('business');

    // No Prisma error in response
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('PrismaClientValidationError');
    expect(bodyStr).not.toContain('Prisma');
  });

  it('PUT without pipeline — HTTP 200, other fields update, pipeline unchanged', { timeout: IT_TIMEOUT }, async () => {
    // Fresh baseline
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } });
    await pg.agentGoalCard.create({
      data: {
        agentId: testAgentId,
        pipeline: 'business',
        longTermDirection: '[HTTP] PUT baseline no-pipeline',
        monthlyGoals: [] as any,
        selfCheckCriteria: 'test',
        status: 'active',
      },
    });
    const before = await pg.agentGoalCard.findUnique({ where: { agentId: testAgentId } });
    expect(before?.pipeline).toBe('business');

    // Update only longTermDirection
    const newDirection = `[HTTP] Updated at ${Date.now()}`;
    const res = await httpPut(`/api/goals/${testAgentId}`, {
      longTermDirection: newDirection,
      changeNote: 'test update without pipeline',
    });
    expect(res.status).toBe(200);
    expect(res.body.goalCard.longTermDirection).toBe(newDirection);

    // Pipeline unchanged
    const after = await pg.agentGoalCard.findUnique({ where: { agentId: testAgentId } });
    expect(after?.pipeline).toBe('business');
    expect(after?.longTermDirection).toBe(newDirection);
  });
});
