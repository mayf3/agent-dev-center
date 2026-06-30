/**
 * CTO Revision Transaction Rollback — Real PostgreSQL Integration Tests
 *
 * Tier: 生产函数 + PrismaClient + 真实PostgreSQL集成测试
 *
 * Tests the CTO reject rollback transaction by calling the extracted
 * executeCtoRejectTransaction helper with real Prisma transaction clients.
 * Verifies that Revision create failures cause full rollback of the
 * entire transaction (CAS + Transition + Revision).
 *
 * Requires KERNEL_TEST_DATABASE_URL.  Skipped when unset.
 *
 * NO_PRODUCTION_DATABASE_ACCESSED
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import {
  executeCtoRejectTransaction,
  TransactionTestHooks,
} from '../routes/reports.js';

const PG_URL = process.env.KERNEL_TEST_DATABASE_URL;
const integration = PG_URL ? describe : describe.skip;
const INTEGRATION_TIMEOUT = 30000;

integration('CTO revision transaction rollback (PostgreSQL)', () => {
  let pg: PrismaClient;
  let counter = 0;
  let testUserA: string;
  let testUserB: string;
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();

  const WORKFLOW_STEPS = [
    { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false },
    { name: 'testing', displayName: '测试', role: 'tester', requiredReports: ['TEST_REPORT'], autoAdvance: false },
    { name: 'cto_review', displayName: 'CTO验收', role: 'cto', requiredReports: ['CTO_REVIEW'], autoAdvance: false },
    { name: 'deploying', displayName: '部署', role: 'ops', requiredReports: ['DEPLOY_CONFIRM'], autoAdvance: false },
    { name: 'done', displayName: '完成', role: 'cto', requiredReports: [], autoAdvance: false },
  ];

  beforeAll(async () => {
    pg = new PrismaClient({ datasourceUrl: PG_URL });
    await pg.$connect();
    const ts = String(Date.now());
    const ua = await pg.user.create({
      data: { id: userAId, name: `cto-rej-user-${ts}`, email: `cto-rej-${ts}-a@t.com`, internalRole: 'backend_developer', role: 'developer', password: 'x' },
      select: { id: true },
    });
    const ub = await pg.user.create({
      data: { id: userBId, name: `cto-rej-admin-${ts}`, email: `cto-rej-${ts}-b@t.com`, internalRole: 'cto', role: 'admin', password: 'x' },
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
        title: `cto-rej-${Date.now()}-${counter}`,
        description: 'CTO revision rollback test',
        priority: 'P2',
        type: 'FEATURE',
        requester: 'test',
        department: 'engineering',
        requesterId: userAId,
        assigneeId: userBId,
        assignee: 'CTOUser',
        currentStep: overrides?.currentStep ?? 'cto_review',
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
        reportType: 'CTO_REVIEW',
        status: 'pending',
        submittedBy: 'CTO Test User',
        submittedById: userBId,
        content: {},
      },
      select: { id: true },
    });
    return r.id;
  }

  // ── Normal path ──────────────────────────────────────────────

  it('T1: normal CTO reject — CAS updated, transition created, revision created', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const req = await createRequirement({ currentStep: 'cto_review', stateVersion: 10 });
    const reportId = await createReport(req.id);

    await pg.$transaction(async (tx) => {
      const currentReq = await tx.requirement.findUnique({ where: { id: req.id } });
      const stateVer = (currentReq?.stateVersion as number) ?? 0;
      await executeCtoRejectTransaction(
        tx as any,
        req.id,
        stateVer,
        { currentStep: 'testing', assigneeId: userAId, assignee: 'DevUser' },
        {
          requirement: { connect: { id: req.id } },
          fromStep: 'cto_review',
          toStep: 'testing',
          action: 'reject',
          actorId: userBId,
          actorName: 'CTOUser',
          actorRole: 'cto',
          comment: 'CTO_REVIEW 报告被打回，步骤回退至 testing',
        },
        {
          requirementId: req.id,
          title: 'cto-rej-test',
          description: '',
          priority: 'P2',
          status: 'in_progress',
          requester: '',
          department: '',
          assignee: 'DevUser',
          revisionNote: 'CTO_REVIEW 报告被打回，步骤回退至 testing',
          operatorId: userBId,
        },
      );
    });

    // Verify requirement CAS updated
    const updatedReq = await pg.requirement.findUnique({ where: { id: req.id } });
    expect(updatedReq!.currentStep).toBe('testing');
    expect(updatedReq!.stateVersion).toBe(11); // 10 → 11 (CAS increment) ... wait, CAS increments by 1

    // Actually: stateVersion 10, casUpdateRequirement does stateVersion: 10+1 = 11
    expect(updatedReq!.stateVersion).toBe(11);

    // Verify exactly 1 transition
    const transitions = await pg.workflowTransition.findMany({
      where: { requirementId: req.id },
    });
    expect(transitions).toHaveLength(1);
    expect(transitions[0].fromStep).toBe('cto_review');
    expect(transitions[0].toStep).toBe('testing');
    expect(transitions[0].action).toBe('reject');
    expect(transitions[0].actorRole).toBe('cto');

    // Verify exactly 1 revision
    const revisions = await pg.requirementRevision.findMany({
      where: { requirementId: req.id },
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].assignee).toBe('DevUser');

    // Report unchanged (report status update happens outside the transaction in reports.ts)
    const report = await pg.requirementReport.findUnique({ where: { id: reportId } });
    expect(report).not.toBeNull();
    expect(report!.status).toBe('pending');
  });

  // ── End failure injection at Revision create ─────────────────

  it('T2: CAS + Transition succeed → Revision create fails → full rollback', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const req = await createRequirement({ currentStep: 'cto_review', stateVersion: 15 });
    const reportId = await createReport(req.id);

    // Snapshot state before transaction
    const reqBefore = await pg.requirement.findUnique({ where: { id: req.id } });

    // Inject failure at the Revision create hook
    const hooks: TransactionTestHooks = {
      beforeRevisionCreate: async () => {
        throw new Error('injected revision failure');
      },
    };

    await expect(
      pg.$transaction(async (tx) => {
        const currentReq = await tx.requirement.findUnique({ where: { id: req.id } });
        const stateVer = (currentReq?.stateVersion as number) ?? 0;
        await executeCtoRejectTransaction(
          tx as any,
          req.id,
          stateVer,
          { currentStep: 'testing', assigneeId: userAId, assignee: 'DevUser' },
          {
            requirement: { connect: { id: req.id } },
            fromStep: 'cto_review',
            toStep: 'testing',
            action: 'reject',
            actorId: userBId,
            actorName: 'CTOUser',
            actorRole: 'cto',
            comment: '测试末端失败注入',
          },
          {
            requirementId: req.id,
            title: 'rollback-test',
            description: '',
            priority: 'P2',
            status: 'in_progress',
            requester: '',
            department: '',
            assignee: 'DevUser',
            revisionNote: '测试末端失败注入',
            operatorId: userBId,
          },
          hooks,
        );
      }),
    ).rejects.toThrow('injected revision failure');

    // ── Verify full rollback ──

    // Requirement restored
    const reqAfter = await pg.requirement.findUnique({ where: { id: req.id } });
    expect(reqAfter!.currentStep).toBe(reqBefore!.currentStep);
    expect(reqAfter!.stateVersion).toBe(reqBefore!.stateVersion);

    // No transitions created
    const transitions = await pg.workflowTransition.findMany({
      where: { requirementId: req.id },
    });
    expect(transitions).toHaveLength(0);

    // No revisions created
    const revisions = await pg.requirementRevision.findMany({
      where: { requirementId: req.id },
    });
    expect(revisions).toHaveLength(0);

    // Report unchanged
    const report = await pg.requirementReport.findUnique({ where: { id: reportId } });
    expect(report!.status).toBe('pending');
  });

  // ── CAS conflict ─────────────────────────────────────────────

  it('T3: stale stateVersion → 409 conflict, no side effects', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const req = await createRequirement({ currentStep: 'cto_review', stateVersion: 20 });
    const reportId = await createReport(req.id);

    // Use a stale stateVersion (19 instead of the actual 20)
    const staleStateVersion = 19;

    await expect(
      pg.$transaction(async (tx) => {
        await executeCtoRejectTransaction(
          tx as any,
          req.id,
          staleStateVersion,
          { currentStep: 'testing', assigneeId: userAId, assignee: 'DevUser' },
          {
            requirement: { connect: { id: req.id } },
            fromStep: 'cto_review',
            toStep: 'testing',
            action: 'reject',
            actorId: userBId,
            actorName: 'CTOUser',
            actorRole: 'cto',
            comment: 'stale stateVersion test',
          },
          {
            requirementId: req.id,
            title: 'conflict-test',
            description: '',
            priority: 'P2',
            status: 'in_progress',
            requester: '',
            department: '',
            assignee: 'DevUser',
            revisionNote: 'should not persist',
            operatorId: userBId,
          },
        );
      }),
    ).rejects.toThrow('冲突');

    // Verify no side effects
    const reqAfter = await pg.requirement.findUnique({ where: { id: req.id } });
    expect(reqAfter!.currentStep).toBe('cto_review');
    expect(reqAfter!.stateVersion).toBe(20);

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
});
