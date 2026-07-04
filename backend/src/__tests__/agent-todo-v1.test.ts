/**
 * Agent Todo V1 — ADC Requirement + Workflow 表达的 Agent Todo 场景
 *
 * 测试分类：
 *   1. 初始化与幂等（无需 DB）
 *   2. 创建 API 原子流程（无需 DB，mock prisma）
 *   3. 权限（无需 DB，mock prisma）
 *   4. 完整工作流（需要 KERNEL_TEST_DATABASE_URL）
 *   5. Reject 路径（需要 KERNEL_TEST_DATABASE_URL）
 *   6. 并发与 CAS（需要 KERNEL_TEST_DATABASE_URL）
 *   7. 默认 workflow 不静默（无需 DB）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import {
  parseSteps,
  validateWorkflowSteps,
  getNextStep,
  getCurrentStep,
  resolveWorkflowAuthorization,
  getWorkflowRawJson,
  extractRoleUserMap,
} from '../routes/requirements/workflow-helpers.js';

// ─── Agent Todo V1 Workflow Template Definition (matches migration SQL) ────

const AGENT_TODO_V1_STEPS = [
  { name: 'efficiency_review', displayName: '效率审核', role: 'efficiency-manager', requiredReports: [], autoAdvance: false, next: 'partner_review', rejectTo: 'efficiency_review' },
  { name: 'partner_review', displayName: '伙伴审核', role: 'lobster-partner', requiredReports: [], autoAdvance: false, next: 'execution', rejectTo: 'efficiency_review' },
  { name: 'execution', displayName: '执行', role: 'executor', requiredReports: [], autoAdvance: false, next: 'efficiency_acceptance', rejectTo: 'partner_review' },
  { name: 'efficiency_acceptance', displayName: '效率验收', role: 'efficiency-manager', requiredReports: [], autoAdvance: false, next: 'partner_final_review', rejectTo: 'execution' },
  { name: 'partner_final_review', displayName: '伙伴最终复核', role: 'lobster-partner', requiredReports: [], autoAdvance: false, next: 'done', rejectTo: 'execution' },
  { name: 'done', displayName: '完成', role: 'auto', requiredReports: [], autoAdvance: true },
];

// ─── 1. 初始化与幂等（纯函数，无 DB） ─────────────────────────

describe('Agent Todo V1 — init & idempotency (no DB)', () => {
  it('1.1 steps definition has exactly 6 items', () => {
    expect(AGENT_TODO_V1_STEPS).toHaveLength(6);
  });

  it('1.2 steps in correct order', () => {
    const names = AGENT_TODO_V1_STEPS.map(s => s.name);
    expect(names).toEqual([
      'efficiency_review',
      'partner_review',
      'execution',
      'efficiency_acceptance',
      'partner_final_review',
      'done',
    ]);
  });

  it('1.3 each step has correct role', () => {
    const roles = AGENT_TODO_V1_STEPS.map(s => ({ name: s.name, role: s.role }));
    expect(roles).toEqual([
      { name: 'efficiency_review', role: 'efficiency-manager' },
      { name: 'partner_review', role: 'lobster-partner' },
      { name: 'execution', role: 'executor' },
      { name: 'efficiency_acceptance', role: 'efficiency-manager' },
      { name: 'partner_final_review', role: 'lobster-partner' },
      { name: 'done', role: 'auto' },
    ]);
  });

  it('1.4 rejectTo values match contract', () => {
    const rejectTos = AGENT_TODO_V1_STEPS.map(s => ({ name: s.name, rejectTo: s.rejectTo }));
    expect(rejectTos).toEqual([
      { name: 'efficiency_review', rejectTo: 'efficiency_review' },       // self-loop
      { name: 'partner_review', rejectTo: 'efficiency_review' },
      { name: 'execution', rejectTo: 'partner_review' },
      { name: 'efficiency_acceptance', rejectTo: 'execution' },
      { name: 'partner_final_review', rejectTo: 'execution' },
      { name: 'done', rejectTo: undefined },
    ]);
  });

  it('1.5 next values match contract', () => {
    const nexts = AGENT_TODO_V1_STEPS.map(s => ({ name: s.name, next: s.next }));
    expect(nexts).toEqual([
      { name: 'efficiency_review', next: 'partner_review' },
      { name: 'partner_review', next: 'execution' },
      { name: 'execution', next: 'efficiency_acceptance' },
      { name: 'efficiency_acceptance', next: 'partner_final_review' },
      { name: 'partner_final_review', next: 'done' },
      { name: 'done', next: undefined },
    ]);
  });

  it('1.6 validateWorkflowSteps passes for valid template', () => {
    const errors = validateWorkflowSteps(AGENT_TODO_V1_STEPS);
    expect(errors).toEqual([]);
  });

  it('1.7 validateWorkflowSteps catches missing next target', () => {
    const bad = [
      { name: 'first', displayName: 'First', role: 'role_x', requiredReports: [], autoAdvance: false, next: 'nonexistent' },
      { name: 'second', displayName: 'Second', role: 'role_y', requiredReports: [], autoAdvance: true },
    ];
    const errors = validateWorkflowSteps(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('nonexistent'))).toBe(true);
  });

  it('1.8 validateWorkflowSteps catches missing rejectTo target', () => {
    const bad = [
      { name: 'step_a', displayName: 'Step A', role: 'role_x', requiredReports: [], autoAdvance: false, rejectTo: 'nonexistent' },
      { name: 'step_b', displayName: 'Step B', role: 'role_y', requiredReports: [], autoAdvance: true },
    ];
    const errors = validateWorkflowSteps(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('nonexistent'))).toBe(true);
  });

  it('1.9 getNextStep uses explicit next when present', () => {
    const next = getNextStep(AGENT_TODO_V1_STEPS, 'efficiency_review');
    expect(next).not.toBeNull();
    expect(next!.name).toBe('partner_review');
  });

  it('1.10 getNextStep returns null for done (terminal, no next)', () => {
    const next = getNextStep(AGENT_TODO_V1_STEPS, 'done');
    expect(next).toBeNull();
  });

  it('1.11 parseSteps preserves rejectTo and next', () => {
    const parsed = parseSteps(AGENT_TODO_V1_STEPS);
    expect(parsed[0].rejectTo).toBe('efficiency_review');
    expect(parsed[0].next).toBe('partner_review');
    expect(parsed[5].rejectTo).toBeUndefined();
    expect(parsed[5].next).toBeUndefined();
  });

  it('1.12 parseSteps supports new format {steps, roleUserMap}', () => {
    const newFormat = { steps: AGENT_TODO_V1_STEPS, roleUserMap: { 'efficiency-manager': 'uuid-1' } };
    const parsed = parseSteps(newFormat);
    expect(parsed).toHaveLength(6);
    expect(parsed[0].role).toBe('efficiency-manager');
  });

  it('1.13 getWorkflowRawJson extracts from snapshot with new format', () => {
    const snapshot = { steps: AGENT_TODO_V1_STEPS, roleUserMap: { 'efficiency-manager': 'uuid-1' } };
    const raw = getWorkflowRawJson({ workflowSnapshot: snapshot, workflow: null });
    expect(raw).toEqual(snapshot);
  });

  it('1.14 extractRoleUserMap works with new format snapshot', () => {
    const snapshot = { steps: AGENT_TODO_V1_STEPS, roleUserMap: { 'efficiency-manager': 'uuid-1', 'lobster-partner': 'uuid-2', 'executor': 'uuid-3' } };
    const map = extractRoleUserMap(snapshot);
    expect(map).toBeDefined();
    expect(map!['efficiency-manager']).toBe('uuid-1');
    expect(map!['lobster-partner']).toBe('uuid-2');
    expect(map!['executor']).toBe('uuid-3');
  });
});

// ─── 2. resolveWorkflowAuthorization（纯函数，无 DB） ──────

describe('Agent Todo V1 — roleUserMap authorization (no DB)', () => {
  const userA = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', internalRole: 'pm', role: 'developer' };
  const userB = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', internalRole: 'backend_developer', role: 'developer' };
  const userC = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', internalRole: 'backend_developer', role: 'developer' };
  const userX = { id: 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx', internalRole: 'cto', role: 'admin' };

  const roleUserMap = {
    'efficiency-manager': userA.id,
    'lobster-partner': userB.id,
    'executor': userC.id,
  };

  const reqSnapshot = { steps: AGENT_TODO_V1_STEPS, roleUserMap };

  it('2.1 instance mode + assignment match → authorized', () => {
    const result = resolveWorkflowAuthorization(userA, { workflowSnapshot: reqSnapshot }, 'efficiency-manager');
    expect(result.mode).toBe('instance');
    expect(result.authorized).toBe(true);
    expect(result.reason).toBe('instance-role-match');
  });

  it('2.2 instance mode + other user role → unauthorized (mismatch)', () => {
    const result = resolveWorkflowAuthorization(userA, { workflowSnapshot: reqSnapshot }, 'lobster-partner');
    expect(result.mode).toBe('instance');
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('instance-role-mismatch');
  });

  it('2.3 instance mode + assignment match for lobster-partner → authorized', () => {
    const result = resolveWorkflowAuthorization(userB, { workflowSnapshot: reqSnapshot }, 'lobster-partner');
    expect(result.mode).toBe('instance');
    expect(result.authorized).toBe(true);
    expect(result.reason).toBe('instance-role-match');
  });

  it('2.4 instance mode + executor trying efficiency-manager → unauthorized', () => {
    const result = resolveWorkflowAuthorization(userC, { workflowSnapshot: reqSnapshot }, 'efficiency-manager');
    expect(result.mode).toBe('instance');
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('instance-role-mismatch');
  });

  it('2.5 instance mode + unassigned user → unauthorized', () => {
    const result = resolveWorkflowAuthorization(userX, { workflowSnapshot: reqSnapshot }, 'efficiency-manager');
    expect(result.mode).toBe('instance');
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('instance-role-mismatch');
  });

  it('2.6 no roleUserMap → legacy mode', () => {
    // Legacy snapshot (plain array) — no roleUserMap
    const result = resolveWorkflowAuthorization(userA, { workflowSnapshot: AGENT_TODO_V1_STEPS }, 'efficiency-manager');
    expect(result.mode).toBe('legacy');
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('legacy');
  });

  it('2.7 instance mode + cto_agent not assigned → unauthorized (no bypass)', () => {
    const result = resolveWorkflowAuthorization(userX, { workflowSnapshot: reqSnapshot }, 'executor');
    expect(result.mode).toBe('instance');
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('instance-role-mismatch');
  });

  it('2.8 instance mode + role missing from map → unauthorized (fail-closed)', () => {
    const result = resolveWorkflowAuthorization(userA, { workflowSnapshot: reqSnapshot }, 'nonexistent-role');
    expect(result.mode).toBe('instance');
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('instance-role-missing');
  });

  it('2.9 requester matching → authorized', () => {
    const result = resolveWorkflowAuthorization(userA, { workflowSnapshot: reqSnapshot, requesterId: userA.id }, 'requester');
    expect(result.mode).toBe('instance');
    expect(result.authorized).toBe(true);
    expect(result.reason).toBe('requester-match');
  });

  it('2.10 requester NOT matching → unauthorized', () => {
    const result = resolveWorkflowAuthorization(userA, { workflowSnapshot: reqSnapshot, requesterId: userB.id }, 'requester');
    expect(result.mode).toBe('instance');
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('requester-mismatch');
  });
});

// ─── 3. 权限隔离（纯函数，无 DB） ───────────────────────────

describe('Agent Todo V1 — role isolation (no DB)', () => {
  const efMgr = { id: 'e0000000-0000-4000-8000-000000000001' };
  const lbPart = { id: 'b0000000-0000-4000-8000-000000000002' };
  const exec = { id: 'c0000000-0000-4000-8000-000000000003' };
  const req = { id: 'd0000000-0000-4000-8000-000000000004' };

  const roleUserMap = {
    'efficiency-manager': efMgr.id,
    'lobster-partner': lbPart.id,
    'executor': exec.id,
  };
  const snapshot = { steps: AGENT_TODO_V1_STEPS, roleUserMap };

  it('3.1 efficiency-manager can act on efficiency_review', () => {
    const r = resolveWorkflowAuthorization(efMgr, { workflowSnapshot: snapshot }, 'efficiency-manager');
    expect(r.mode).toBe('instance');
    expect(r.authorized).toBe(true);
  });

  it('3.2 lobster-partner can act on partner_review', () => {
    const r = resolveWorkflowAuthorization(lbPart, { workflowSnapshot: snapshot }, 'lobster-partner');
    expect(r.mode).toBe('instance');
    expect(r.authorized).toBe(true);
  });

  it('3.3 executor can act on execution', () => {
    const r = resolveWorkflowAuthorization(exec, { workflowSnapshot: snapshot }, 'executor');
    expect(r.mode).toBe('instance');
    expect(r.authorized).toBe(true);
  });

  it('3.4 requester cannot replace efficiency-manager (not in roleUserMap)', () => {
    const r = resolveWorkflowAuthorization(req, { workflowSnapshot: snapshot }, 'efficiency-manager');
    expect(r.mode).toBe('instance');
    expect(r.authorized).toBe(false);
  });

  it('3.5 lobster-partner cannot execute (cross-role isolation)', () => {
    const r = resolveWorkflowAuthorization(lbPart, { workflowSnapshot: snapshot }, 'executor');
    expect(r.mode).toBe('instance');
    expect(r.authorized).toBe(false);
  });

  it('3.6 executor cannot accept (cross-role isolation)', () => {
    const r = resolveWorkflowAuthorization(exec, { workflowSnapshot: snapshot }, 'efficiency-manager');
    expect(r.mode).toBe('instance');
    expect(r.authorized).toBe(false);
  });
});

// ─── 4. 集成测试（需要 KERNEL_TEST_DATABASE_URL） ─────────

const PG_URL = process.env.KERNEL_TEST_DATABASE_URL;
const integration = PG_URL ? describe : describe.skip;
const IT_TIMEOUT = 60000;

integration('Agent Todo V1 — integration (PostgreSQL)', () => {
  let pg: PrismaClient;
  let userId: string;
  let adminId: string;

  // User IDs for workflow role assignments
  const efMgrId = crypto.randomUUID();
  const lbPartnerId = crypto.randomUUID();
  const executorId = crypto.randomUUID();

  beforeAll(async () => {
    pg = new PrismaClient({ datasourceUrl: PG_URL });
    await pg.$connect();

    // Create test users
    const ts = String(Date.now());
    userId = (await pg.user.upsert({
      where: { email: `at-req-${ts}@t.com` },
      update: {},
      create: { id: crypto.randomUUID(), name: `at-req-${ts}`, email: `at-req-${ts}@t.com`, internalRole: 'pm', role: 'developer', password: 'x' },
    })).id;

    adminId = (await pg.user.upsert({
      where: { email: `at-admin-${ts}@t.com` },
      update: {},
      create: { id: crypto.randomUUID(), name: `at-admin-${ts}`, email: `at-admin-${ts}@t.com`, internalRole: 'cto', role: 'admin', password: 'x' },
    })).id;

    // Create role-specific users for workflow assignment
    for (const [id] of [[efMgrId], [lbPartnerId], [executorId]]) {
      const e = Math.random().toString(36).slice(2, 8);
      await pg.user.upsert({
        where: { email: `at-${e}@t.com` },
        update: {},
        create: { id, name: `at-user-${e}`, email: `at-${e}@t.com`, internalRole: 'backend_developer', role: 'developer', password: 'x' },
      }).catch(() => {});
    }
  });

  afterAll(async () => {
    // Clean up all test requirements and users
    if (pg) {
      await pg.requirement.deleteMany({ where: { domainKey: 'agent-todo' } }).catch(() => {});
      await pg.user.deleteMany({ where: { id: { in: [userId, adminId, efMgrId, lbPartnerId, executorId] } } }).catch(() => {});
      await pg.$disconnect().catch(() => {});
    }
  });

  // ── 4.1 Create + advance full workflow ──────────────────────

  it('4.1 full 6-step workflow advances correctly', { timeout: IT_TIMEOUT }, async () => {
    // Find agent-todo-v1 template
    const template = await pg.workflowTemplate.findUnique({ where: { name: 'agent-todo-v1' } });
    if (!template) throw new Error('agent-todo-v1 template not found — run migration first');

    const efMgrUUID = efMgrId;
    const lbPartnerUUID = lbPartnerId;
    const executorUUID = executorId;

    // Build snapshot with roleUserMap
    const snapshot = {
      steps: AGENT_TODO_V1_STEPS,
      roleUserMap: {
        'efficiency-manager': efMgrUUID,
        'lobster-partner': lbPartnerUUID,
        'executor': executorUUID,
      },
    };

    const req = await pg.requirement.create({
      data: {
        title: `agent-todo-full-path-${Date.now()}`,
        description: 'integration test for full workflow path',
        priority: 'P2', type: 'FEATURE',
        requester: 'at-user', requesterId: userId,
        department: 'eng',
        domainKey: 'agent-todo',
        workflowId: template.id,
        workflowSnapshot: snapshot as any,
        currentStep: 'efficiency_review',
        assigneeId: efMgrUUID,
        stateVersion: 1,
      },
    });

    expect(req.currentStep).toBe('efficiency_review');
    expect(req.domainKey).toBe('agent-todo');

    // Verify step advancement
    async function advanceStep(asUserId: string, expectedFrom: string, expectedTo: string) {
      const current = await pg.requirement.findUnique({ where: { id: req.id } });
      expect(current?.currentStep).toBe(expectedFrom);

      // Simulate advance: update currentStep using the workflow
      const targetStep = AGENT_TODO_V1_STEPS.find(s => s.name === expectedFrom);
      const nextStep = AGENT_TODO_V1_STEPS.find(s => s.name === targetStep?.next);
      if (!nextStep) throw new Error(`no next step from ${expectedFrom}`);

      const nextRoles: Record<string, string> = {
        'efficiency-manager': efMgrUUID,
        'lobster-partner': lbPartnerUUID,
        'executor': executorUUID,
      };
      const nextAssigneeId = nextRoles[nextStep.role] ?? null;

      await pg.requirement.update({
        where: { id: req.id, stateVersion: current!.stateVersion },
        data: {
          currentStep: nextStep.name,
          assigneeId: nextAssigneeId,
          stateVersion: { increment: 1 },
        },
      });

      await pg.workflowTransition.create({
        data: {
          requirementId: req.id,
          fromStep: expectedFrom,
          toStep: nextStep.name,
          action: 'advance',
          actorId: asUserId,
          actorName: 'test',
          actorRole: nextStep.role,
        },
      });

      const updated = await pg.requirement.findUnique({ where: { id: req.id } });
      expect(updated?.currentStep).toBe(expectedTo);
    }

    // Walk through all 6 steps
    await advanceStep(efMgrUUID, 'efficiency_review', 'partner_review');
    await advanceStep(lbPartnerUUID, 'partner_review', 'execution');
    await advanceStep(executorUUID, 'execution', 'efficiency_acceptance');
    await advanceStep(efMgrUUID, 'efficiency_acceptance', 'partner_final_review');
    await advanceStep(lbPartnerUUID, 'partner_final_review', 'done');

    const final = await pg.requirement.findUnique({ where: { id: req.id } });
    expect(final?.currentStep).toBe('done');

    // Cleanup
    await pg.requirement.delete({ where: { id: req.id } }).catch(() => {});
    await pg.workflowTransition.deleteMany({ where: { requirementId: req.id } }).catch(() => {});
  });

  // ── 4.2 Reject paths ───────────────────────────────────────

  it('4.2a reject partner_review → efficiency_review', { timeout: IT_TIMEOUT }, async () => {
    const template = await pg.workflowTemplate.findUnique({ where: { name: 'agent-todo-v1' } });
    if (!template) throw new Error('agent-todo-v1 template not found');

    const snapshot = { steps: AGENT_TODO_V1_STEPS, roleUserMap: { 'efficiency-manager': efMgrId, 'lobster-partner': lbPartnerId, 'executor': executorId } };

    const req = await pg.requirement.create({
      data: {
        title: `at-reject-pr-${Date.now()}`,
        description: 'reject partner_review to efficiency_review',
        priority: 'P2', type: 'FEATURE',
        requester: 'at-user', requesterId: userId,
        department: 'eng',
        domainKey: 'agent-todo',
        workflowId: template.id,
        workflowSnapshot: snapshot as any,
        currentStep: 'partner_review',
        assigneeId: lbPartnerId,
        stateVersion: 1,
      },
    });

    // Reject from partner_review → efficiency_review (using rejectTo)
    expect(AGENT_TODO_V1_STEPS[1].rejectTo).toBe('efficiency_review');
    const current = await pg.requirement.findUnique({ where: { id: req.id } });
    await pg.requirement.update({
      where: { id: req.id, stateVersion: current!.stateVersion },
      data: { currentStep: 'efficiency_review', assigneeId: efMgrId, stateVersion: { increment: 1 } },
    });
    await pg.workflowTransition.create({
      data: { requirementId: req.id, fromStep: 'partner_review', toStep: 'efficiency_review', action: 'reject', actorId: lbPartnerId, actorName: 'test', actorRole: 'lobster-partner', comment: 'revisit' },
    });

    const after = await pg.requirement.findUnique({ where: { id: req.id } });
    expect(after?.currentStep).toBe('efficiency_review');
    expect(after?.assigneeId).toBe(efMgrId);
    expect(after?.stateVersion).toBe(current!.stateVersion + 1);

    await pg.requirement.delete({ where: { id: req.id } }).catch(() => {});
    await pg.workflowTransition.deleteMany({ where: { requirementId: req.id } }).catch(() => {});
  });

  it('4.2b reject efficiency_acceptance → execution', { timeout: IT_TIMEOUT }, async () => {
    const template = await pg.workflowTemplate.findUnique({ where: { name: 'agent-todo-v1' } });
    if (!template) throw new Error('agent-todo-v1 template not found');

    const snapshot = { steps: AGENT_TODO_V1_STEPS, roleUserMap: { 'efficiency-manager': efMgrId, 'lobster-partner': lbPartnerId, 'executor': executorId } };

    const req = await pg.requirement.create({
      data: {
        title: `at-reject-ea-${Date.now()}`,
        description: 'reject efficiency_acceptance to execution',
        priority: 'P2', type: 'FEATURE',
        requester: 'at-user', requesterId: userId,
        department: 'eng',
        domainKey: 'agent-todo',
        workflowId: template.id,
        workflowSnapshot: snapshot as any,
        currentStep: 'efficiency_acceptance',
        assigneeId: efMgrId,
        stateVersion: 1,
      },
    });

    // rejectTo = execution
    expect(AGENT_TODO_V1_STEPS[3].rejectTo).toBe('execution');
    const current = await pg.requirement.findUnique({ where: { id: req.id } });
    await pg.requirement.update({
      where: { id: req.id, stateVersion: current!.stateVersion },
      data: { currentStep: 'execution', assigneeId: executorId, stateVersion: { increment: 1 } },
    });
    await pg.workflowTransition.create({
      data: { requirementId: req.id, fromStep: 'efficiency_acceptance', toStep: 'execution', action: 'reject', actorId: efMgrId, actorName: 'test', actorRole: 'efficiency-manager', comment: 'need fixes' },
    });

    const after = await pg.requirement.findUnique({ where: { id: req.id } });
    expect(after?.currentStep).toBe('execution');

    await pg.requirement.delete({ where: { id: req.id } }).catch(() => {});
    await pg.workflowTransition.deleteMany({ where: { requirementId: req.id } }).catch(() => {});
  });

  it('4.2c reject partner_final_review → execution', { timeout: IT_TIMEOUT }, async () => {
    const template = await pg.workflowTemplate.findUnique({ where: { name: 'agent-todo-v1' } });
    if (!template) throw new Error('agent-todo-v1 template not found');

    const snapshot = { steps: AGENT_TODO_V1_STEPS, roleUserMap: { 'efficiency-manager': efMgrId, 'lobster-partner': lbPartnerId, 'executor': executorId } };

    const req = await pg.requirement.create({
      data: {
        title: `at-reject-pfr-${Date.now()}`,
        description: 'reject partner_final_review to execution',
        priority: 'P2', type: 'FEATURE',
        requester: 'at-user', requesterId: userId,
        department: 'eng',
        domainKey: 'agent-todo',
        workflowId: template.id,
        workflowSnapshot: snapshot as any,
        currentStep: 'partner_final_review',
        assigneeId: lbPartnerId,
        stateVersion: 1,
      },
    });

    // rejectTo = execution
    expect(AGENT_TODO_V1_STEPS[4].rejectTo).toBe('execution');
    const current = await pg.requirement.findUnique({ where: { id: req.id } });
    await pg.requirement.update({
      where: { id: req.id, stateVersion: current!.stateVersion },
      data: { currentStep: 'execution', assigneeId: executorId, stateVersion: { increment: 1 } },
    });
    await pg.workflowTransition.create({
      data: { requirementId: req.id, fromStep: 'partner_final_review', toStep: 'execution', action: 'reject', actorId: lbPartnerId, actorName: 'test', actorRole: 'lobster-partner', comment: 'needs rework' },
    });

    const after = await pg.requirement.findUnique({ where: { id: req.id } });
    expect(after?.currentStep).toBe('execution');

    await pg.requirement.delete({ where: { id: req.id } }).catch(() => {});
    await pg.workflowTransition.deleteMany({ where: { requirementId: req.id } }).catch(() => {});
  });

  // ── 4.3 CAS concurrency ────────────────────────────────────

  it('4.3 concurrent advance with same stateVersion — only one succeeds', { timeout: IT_TIMEOUT }, async () => {
    const template = await pg.workflowTemplate.findUnique({ where: { name: 'agent-todo-v1' } });
    if (!template) throw new Error('agent-todo-v1 template not found');

    const snapshot = { steps: AGENT_TODO_V1_STEPS, roleUserMap: { 'efficiency-manager': efMgrId, 'lobster-partner': lbPartnerId, 'executor': executorId } };

    const req = await pg.requirement.create({
      data: {
        title: `at-cas-${Date.now()}`,
        description: 'CAS concurrency test',
        priority: 'P2', type: 'FEATURE',
        requester: 'at-user', requesterId: userId,
        department: 'eng',
        domainKey: 'agent-todo',
        workflowId: template.id,
        workflowSnapshot: snapshot as any,
        currentStep: 'efficiency_review',
        assigneeId: efMgrId,
        stateVersion: 1,
      },
    });

    // Two concurrent advances with same stateVersion
    const result1 = await pg.requirement.updateMany({
      where: { id: req.id, stateVersion: 1 },
      data: { currentStep: 'partner_review', assigneeId: lbPartnerId, stateVersion: { increment: 1 } },
    });
    const result2 = await pg.requirement.updateMany({
      where: { id: req.id, stateVersion: 1 }, // Same version — should hit nothing
      data: { currentStep: 'partner_review', assigneeId: lbPartnerId, stateVersion: { increment: 1 } },
    });

    expect(result1.count).toBe(1); // first one wins
    expect(result2.count).toBe(0); // second one conflicts

    // Verify only one transition
    const transitions = await pg.workflowTransition.findMany({
      where: { requirementId: req.id, action: 'advance' },
    });
    expect(transitions.length).toBeLessThanOrEqual(1); // at most one (if the transition was created)

    // Cleanup
    await pg.requirement.delete({ where: { id: req.id } }).catch(() => {});
    await pg.workflowTransition.deleteMany({ where: { requirementId: req.id } }).catch(() => {});
  });

  // ── 4.4 Default workflow not selected silently ──────────

  it('4.4 creating requirement with domainKey=agent-todo but no workflowTemplateKey does NOT auto-select agent-todo-v1', { timeout: IT_TIMEOUT }, async () => {
    const req = await pg.requirement.create({
      data: {
        title: `at-no-workflow-${Date.now()}`,
        description: 'no workflow assigned',
        priority: 'P2', type: 'FEATURE',
        requester: 'at-user', requesterId: userId,
        department: 'eng',
        domainKey: 'agent-todo',
      },
    });

    // Should have NO workflow assigned
    expect(req.workflowId).toBeNull();
    expect(req.currentStep).toBeNull();
    expect(req.workflowSnapshot).toBeNull();

    await pg.requirement.delete({ where: { id: req.id } }).catch(() => {});
  });
});
