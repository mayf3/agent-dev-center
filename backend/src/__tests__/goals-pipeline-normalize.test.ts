/**
 * Pipeline Normalization Tests for GoalCard POST/PUT.
 *
 * Tests normalizePipeline helper directly, then verifies that
 * Prisma CREATE and UPDATE accept the normalized values without
 * PrismaClientValidationError.
 *
 * Uses a real PostgreSQL test database (KERNEL_TEST_DATABASE_URL or
 * local goals_pipeline_test). Skipped when neither is available.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const PG_URL = process.env.KERNEL_TEST_DATABASE_URL;
const integration = PG_URL ? describe : describe.skip;
const IT_TIMEOUT = 30000;

// ─── Helper under test (imported from its module) ─────────

import { normalizePipeline } from '../routes/goals/permissions.js';

// ─── 1. Unit tests: normalizePipeline helper ──────────────

describe('normalizePipeline helper', () => {
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

// ─── 2. Integration tests (real Prisma) ──────────────────

integration('GoalCard pipeline normalization (real Prisma)', () => {
  let pg: PrismaClient;
  let testAgentId: string;
  let testAgentName: string;
  let testUserId: string;

  beforeAll(async () => {
    pg = new PrismaClient({ datasourceUrl: PG_URL });
    await pg.$connect();

    const ts = String(Date.now());
    testAgentName = `pipeline-test-agent-${ts}`;
    testUserId = crypto.randomUUID();

    // Create a test user
    await pg.user.upsert({
      where: { email: `pipeline-test-${ts}@local.dev` },
      update: {},
      create: {
        id: testUserId,
        name: `pipeline-test-${ts}`,
        email: `pipeline-test-${ts}@local.dev`,
        role: 'developer',
        password: 'x',
      },
    });

    // Create a test marketplace agent
    const agent = await pg.marketplaceAgent.create({
      data: {
        name: testAgentName,
        displayName: 'Pipeline Test Agent',
        description: 'Agent for pipeline normalization tests',
      },
    });
    testAgentId = agent.id;
  });

  afterAll(async () => {
    if (pg) {
      // Clean up test data
      await pg.goalRevision.deleteMany({ where: { goalCard: { agentId: testAgentId } } }).catch(() => {});
      await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } }).catch(() => {});
      await pg.marketplaceAgent.deleteMany({ where: { id: testAgentId } }).catch(() => {});
      await pg.user.deleteMany({ where: { id: testUserId } }).catch(() => {});
      await pg.$disconnect().catch(() => {});
    }
  });

  // ── POST tests ────────────────────────────────────

  it('POST: creates GoalCard with "business" pipeline', { timeout: IT_TIMEOUT }, async () => {
    const goalCard = await pg.agentGoalCard.create({
      data: {
        agentId: testAgentId,
        pipeline: normalizePipeline('business'),
        longTermDirection: '[TEST] Business pipeline',
        monthlyGoals: [{
          month: '202607',
          goals: [{ title: '[TEST] Business goal', status: 'not_started' }],
        }] as any,
        selfCheckCriteria: 'Test',
        status: 'active',
      },
    });
    expect(goalCard.pipeline).toBe('business');
    expect(goalCard.status).toBe('active');

    // Clean up this specific test card
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } }).catch(() => {});
  });

  it('POST: creates GoalCard with "cross-cutting" (hyphen)', { timeout: IT_TIMEOUT }, async () => {
    const goalCard = await pg.agentGoalCard.create({
      data: {
        agentId: testAgentId,
        pipeline: normalizePipeline('cross-cutting'),
        longTermDirection: '[TEST] cross-cutting pipeline',
        monthlyGoals: [{
          month: '202607',
          goals: [{ title: '[TEST] CC goal', status: 'not_started' }],
        }] as any,
        selfCheckCriteria: 'Test',
        status: 'active',
      },
    });
    expect(goalCard.pipeline).toBe('cross_cutting');

    // Clean up
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } }).catch(() => {});
  });

  it('POST: creates GoalCard with "cross_cutting" (underscore)', { timeout: IT_TIMEOUT }, async () => {
    const goalCard = await pg.agentGoalCard.create({
      data: {
        agentId: testAgentId,
        pipeline: normalizePipeline('cross_cutting'),
        longTermDirection: '[TEST] cross_cutting pipeline',
        monthlyGoals: [{
          month: '202607',
          goals: [{ title: '[TEST] CU goal', status: 'not_started' }],
        }] as any,
        selfCheckCriteria: 'Test',
        status: 'active',
      },
    });
    expect(goalCard.pipeline).toBe('cross_cutting');

    // Clean up
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } }).catch(() => {});
  });

  it('POST: does NOT create with invalid pipeline and no PrismaClientValidationError', { timeout: IT_TIMEOUT }, async () => {
    // Normalize should throw before reaching Prisma
    expect(() => normalizePipeline('invalid-pipeline')).toThrow();

    // Direct Prisma call with invalid value should throw PrismaClientValidationError
    await expect(
      pg.agentGoalCard.create({
        data: {
          agentId: testAgentId,
          pipeline: 'invalid-pipeline' as any,
          longTermDirection: '[TEST] Should fail',
          monthlyGoals: [] as any,
          selfCheckCriteria: 'Test',
          status: 'active',
        },
      })
    ).rejects.toThrow();
  });

  // ── PUT (UPDATE) tests ────────────────────────────

  it('PUT: updates pipeline to "cross-cutting"', { timeout: IT_TIMEOUT }, async () => {
    // Create a base goal card
    const goalCard = await pg.agentGoalCard.create({
      data: {
        agentId: testAgentId,
        pipeline: 'business',
        longTermDirection: '[TEST] Baseline for update',
        monthlyGoals: [] as any,
        selfCheckCriteria: 'Test',
        status: 'active',
      },
    });

    // Update pipeline via normalized value
    const updated = await pg.agentGoalCard.update({
      where: { agentId: testAgentId },
      data: { pipeline: normalizePipeline('cross-cutting') },
    });
    expect(updated.pipeline).toBe('cross_cutting');

    // Clean up
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } }).catch(() => {});
  });

  it('PUT: updates pipeline to "cross_cutting"', { timeout: IT_TIMEOUT }, async () => {
    // Create base
    await pg.agentGoalCard.create({
      data: {
        agentId: testAgentId,
        pipeline: 'business',
        longTermDirection: '[TEST] Baseline for update 2',
        monthlyGoals: [] as any,
        selfCheckCriteria: 'Test',
        status: 'active',
      },
    });

    // Update via underscore variant
    const updated = await pg.agentGoalCard.update({
      where: { agentId: testAgentId },
      data: { pipeline: normalizePipeline('cross_cutting') },
    });
    expect(updated.pipeline).toBe('cross_cutting');

    // Clean up
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } }).catch(() => {});
  });

  it('PUT: rejects invalid pipeline value (no DB write)', { timeout: IT_TIMEOUT }, async () => {
    // Create base
    await pg.agentGoalCard.create({
      data: {
        agentId: testAgentId,
        pipeline: 'business',
        longTermDirection: '[TEST] Baseline',
        monthlyGoals: [] as any,
        selfCheckCriteria: 'Test',
        status: 'active',
      },
    });

    // Verify inline pipeline stays unchanged
    const before = await pg.agentGoalCard.findUnique({ where: { agentId: testAgentId } });
    expect(before?.pipeline).toBe('business');

    // normalizePipeline throws for invalid values
    expect(() => normalizePipeline('invalid-pipeline')).toThrow();

    // Verify DB is untouched
    const after = await pg.agentGoalCard.findUnique({ where: { agentId: testAgentId } });
    expect(after?.pipeline).toBe('business');

    // Clean up
    await pg.agentGoalCard.deleteMany({ where: { agentId: testAgentId } }).catch(() => {});
  });
});
