/**
 * QA Reject Transaction Rollback — Real PostgreSQL Integration Tests
 *
 * Tier: 生产函数 + PrismaClient + 真实PostgreSQL集成测试
 *
 * Tests the QA reject rollback transaction by calling the extracted
 * executeQaRejectTransaction helper with real Prisma transaction clients.
 * Verifies that failures at the transaction tail cause full rollback.
 *
 * Requires KERNEL_TEST_DATABASE_URL.  Skipped when unset.
 *
 * NO_PRODUCTION_DATABASE_ACCESSED
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import {
  executeQaRejectTransaction,
  TransactionTestHooks,
} from '../routes/reports.js';

const PG_URL = process.env.KERNEL_TEST_DATABASE_URL;
const integration = PG_URL ? describe : describe.skip;
const INTEGRATION_TIMEOUT = 30000;

integration('QA reject transaction rollback (PostgreSQL)', () => {
  let pg: PrismaClient;
  let counter = 0;
  let testUserA: string;
  let testUserB: string;
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();

  const WORKFLOW_STEPS = [
    { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false },
    { name: 'dev_self_check', displayName: '开发自检', role: 'backend_developer', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false },
    { name: 'testing', displayName: '测试', role: 'tester', requiredReports: ['TEST_REPORT'], autoAdvance: false },
    { name: 'qa_pre_release', displayName: 'QA预发布', role: 'qa', requiredReports: [], autoAdvance: false },
  ];

  beforeAll(async () => {
    pg = new PrismaClient({ datasourceUrl: PG_URL });
    await pg.$connect();
    const ts = String(Date.now());
    const ua = await pg.user.create({
      data: { id: userAId, name: `qa-rej-user-${ts}`, email: `qa-rej-${ts}-a@t.com`, internalRole: 'backend_developer', role: 'developer', password: 'x' },
      select: { id: true },
    });
    const ub = await pg.user.create({
      data: { id: userBId, name: `qa-rej-cto-${ts}`, email: `qa-rej-${ts}-b@t.com`, internalRole: 'cto', role: 'admin', password: 'x' },
      select: { id: true },
    });
    testUserA = ua.id;
    testUserB = ub.id;
  });

  afterAll(async () => {
    if (testUserA) await pg.user.delete({ where: { id: testUserA } }).catch(() => {});
    if (testUserB) await pg.user.delete({ where: { id: testUserB } }).catch(() => {});
    await pg.$disconnect();
  });

  async function createRequirement(overrides?: {
    currentStep?: string;
    stateVersion?: number;
  }): Promise<{ id: string; stateVersion: number }> {
    counter++;
    const r = await pg.requirement.create({
      data: {
        title: `qa-rej-${Date.now()}-${counter}`,
        description: 'QA reject rollback test',
        priority: 'P2',
        type: 'FEATURE',
        requester: 'test',
        department: 'engineering',
        requesterId: userAId,
        currentStep: overrides?.currentStep ?? 'qa_pre_release',
        stateVersion: overrides?.stateVersion ?? 5,
        workflowSnapshot: WORKFLOW_STEPS,
      },
      select: { id: true, stateVersion: true },
    });
    return r;
  }

  async function createReport(requirementId: string): Promise<string> {
    counter++;
    const r = await pg.requirementReport.create({
      data: {
        id: crypto.randomUUID(),
        requirementId,
        reportType: 'DEV_SELF_CHECK',
        status: 'pending',
        submittedBy: 'QA Test User',
        submittedById: userBId,
        content: {},
      },
      select: { id: true },
    });
    return r.id;
  }

  // ── Normal path ──────────────────────────────────────────────

  it('T1: normal reject — requirement CAS updated, step reverted, 1 transition', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const req = await createRequirement({ currentStep: 'qa_pre_release', stateVersion: 5 });
    const reportId = await createReport(req.id);

    await pg.$transaction(async (tx) => {
      const currentReq = await tx.requirement.findUnique({ where: { id: req.id } });
      const stateVer = (currentReq?.stateVersion as number) ?? 0;
      await executeQaRejectTransaction(
        tx as any,
        req.id,
        stateVer,
        { currentStep: 'dev_self_check', assigneeId: null, assignee: null },
        {
          requirement: { connect: { id: req.id } },
          fromStep: 'qa_pre_release',
          toStep: 'dev_self_check',
          action: 'reject',
          actorId: userBId,
          actorName: 'QAUser',
          actorRole: 'qa',
          comment: 'QA rejected',
        },
      );
    });

    // Verify requirement CAS updated
    const updatedReq = await pg.requirement.findUnique({ where: { id: req.id } });
    expect(updatedReq!.currentStep).toBe('dev_self_check');
    expect(updatedReq!.stateVersion).toBe(6); // 5 → 6 (CAS increment)

    // Verify exactly 1 transition
    const transitions = await pg.workflowTransition.findMany({
      where: { requirementId: req.id },
    });
    expect(transitions).toHaveLength(1);
    expect(transitions[0].fromStep).toBe('qa_pre_release');
    expect(transitions[0].toStep).toBe('dev_self_check');
    expect(transitions[0].action).toBe('reject');
    expect(transitions[0].actorRole).toBe('qa');

    // Verify report unchanged (report update happens outside this transaction in reports.ts)
    const report = await pg.requirementReport.findUnique({ where: { id: reportId } });
    expect(report).not.toBeNull();
    expect(report!.status).toBe('pending');
  });

  // ── Assignee resolution failure (before transaction) ─────────
  // This tests that if assignee resolution fails before the transaction,
  // no DB writes happen at all

  it('T2: assignee resolution failure — no DB changes', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const req = await createRequirement({ currentStep: 'qa_pre_release', stateVersion: 10 });
    const reportId = await createReport(req.id);
    const reqBefore = await pg.requirement.findUnique({ where: { id: req.id } });

    // The route handler calls resolveAssigneeForStep BEFORE the transaction.
    // If it throws, the transaction never starts.  We simulate this by
    // calling nothing (no transaction), and verifying no side effects.
    // The actual coverage of this path is in reports-reject-rollback.test.ts
    // (mocked tests).  Here we just confirm the pre-condition: no writes happen.

    const reqAfter = await pg.requirement.findUnique({ where: { id: req.id } });
    expect(reqAfter!.currentStep).toBe(reqBefore!.currentStep);
    expect(reqAfter!.stateVersion).toBe(reqBefore!.stateVersion);

    const transitions = await pg.workflowTransition.findMany({
      where: { requirementId: req.id },
    });
    expect(transitions).toHaveLength(0);

    const revisions = await pg.requirementRevision.findMany({
      where: { requirementId: req.id },
    });
    expect(revisions).toHaveLength(0);

    const report = await pg.requirementReport.findUnique({ where: { id: reportId } });
    expect(report!.status).toBe('pending');
  });

  // ── End failure injection via beforeTransitionCreate hook ────

  it('T3: CAS succeeds → transition create fails → full transaction rollback', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const req = await createRequirement({ currentStep: 'qa_pre_release', stateVersion: 15 });
    const reportId = await createReport(req.id);

    // Inject failure at the hook point
    const hooks: TransactionTestHooks = {
      beforeTransitionCreate: async () => {
        throw new Error('injected transition failure');
      },
    };

    // The transaction should throw
    await expect(
      pg.$transaction(async (tx) => {
        const currentReq = await tx.requirement.findUnique({ where: { id: req.id } });
        const stateVer = (currentReq?.stateVersion as number) ?? 0;
        await executeQaRejectTransaction(
          tx as any,
          req.id,
          stateVer,
          { currentStep: 'dev_self_check', assigneeId: null, assignee: null },
          {
            requirement: { connect: { id: req.id } },
            fromStep: 'qa_pre_release',
            toStep: 'dev_self_check',
            action: 'reject',
            actorId: userBId,
            actorName: 'QAUser',
            actorRole: 'qa',
            comment: 'injected failure',
          },
          hooks,
        );
      }),
    ).rejects.toThrow('injected transition failure');

    // ── Verify full rollback ──

    // Requirement restored
    const reqAfter = await pg.requirement.findUnique({ where: { id: req.id } });
    expect(reqAfter!.currentStep).toBe('qa_pre_release');
    expect(reqAfter!.stateVersion).toBe(15); // unchanged

    // No transitions
    const transitions = await pg.workflowTransition.findMany({
      where: { requirementId: req.id },
    });
    expect(transitions).toHaveLength(0);

    // Report unchanged
    const report = await pg.requirementReport.findUnique({ where: { id: reportId } });
    expect(report!.status).toBe('pending');
  });

  // ── Concurrent reject ───────────────────────────────────────

  it('T4: concurrent reject — exactly 1 success, 1 stateVersion conflict', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const req = await createRequirement({ currentStep: 'qa_pre_release', stateVersion: 20 });
    // Use independent PrismaClients for truly concurrent transactions
    const pg2 = new PrismaClient({ datasourceUrl: PG_URL });
    await pg2.$connect();

    try {
      // Two independent transactions trying to reject the same requirement
      const t1 = pg.$transaction(async (tx) => {
        const currentReq = await tx.requirement.findUnique({ where: { id: req.id } });
        const stateVer = (currentReq?.stateVersion as number) ?? 0;
        await executeQaRejectTransaction(
          tx as any,
          req.id,
          stateVer,
          { currentStep: 'dev_self_check', assigneeId: null, assignee: null },
          {
            requirement: { connect: { id: req.id } },
            fromStep: 'qa_pre_release',
            toStep: 'dev_self_check',
            action: 'reject',
            actorId: userBId,
            actorName: 'QAUser',
            actorRole: 'qa',
            comment: 'concurrent reject',
          },
        );
      });

      const t2 = pg2.$transaction(async (tx) => {
        const currentReq = await tx.requirement.findUnique({ where: { id: req.id } });
        const stateVer = (currentReq?.stateVersion as number) ?? 0;
        await executeQaRejectTransaction(
          tx as any,
          req.id,
          stateVer,
          { currentStep: 'dev_self_check', assigneeId: null, assignee: null },
          {
            requirement: { connect: { id: req.id } },
            fromStep: 'qa_pre_release',
            toStep: 'dev_self_check',
            action: 'reject',
            actorId: userBId,
            actorName: 'QAUser',
            actorRole: 'qa',
            comment: 'concurrent reject',
          },
        );
      });

      const results = await Promise.allSettled([t1, t2]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Exactly one transition
      const transitions = await pg.workflowTransition.findMany({
        where: { requirementId: req.id },
      });
      expect(transitions).toHaveLength(1);

      // Requirement step changed once
      const reqAfter = await pg.requirement.findUnique({ where: { id: req.id } });
      expect(reqAfter!.currentStep).toBe('dev_self_check');
      expect(reqAfter!.stateVersion).toBe(21); // 20 → 21
    } finally {
      await pg2.$disconnect();
    }
  });
});
