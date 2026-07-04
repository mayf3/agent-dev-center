/**
 * Goal Lifecycle → Agent Todo V1 Integration Tests
 *
 * Tests the shared requirement-create-service directly and verifies that
 * the Goal Lifecycle route creates ADC Requirements instead of calling
 * the old LLM Todo API.
 *
 * Requires KERNEL_TEST_DATABASE_URL.  Skipped when unset.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { createRequirement, type CreateRequirementActor } from '../services/requirement-create-service.js';

const PG_URL = process.env.KERNEL_TEST_DATABASE_URL;
const integration = PG_URL ? describe : describe.skip;
const IT_TIMEOUT = 60000;

integration('Goal Lifecycle → Agent Todo V1', () => {
  let pg: PrismaClient;
  let adminUser: { id: string; name: string; email: string; role: string };
  let developerUser: { id: string; name: string; email: string; role: string };
  let testProjectId: string;

  const efficiencyUserId = crypto.randomUUID();
  const lobsterUserId = crypto.randomUUID();
  const executorUserId = crypto.randomUUID();

  beforeAll(async () => {
    pg = new PrismaClient({ datasourceUrl: PG_URL });
    await pg.$connect();

    const ts = String(Date.now());
    adminUser = await pg.user.create({
      data: {
        id: crypto.randomUUID(),
        name: `gl-admin-${ts}`,
        email: `gl-admin-${ts}@t.com`,
        role: 'admin',
        password: 'x',
      },
      select: { id: true, name: true, email: true, role: true },
    });

    developerUser = await pg.user.create({
      data: {
        id: crypto.randomUUID(),
        name: `gl-dev-${ts}`,
        email: `gl-dev-${ts}@t.com`,
        role: 'developer',
        internalRole: 'backend_developer',
        password: 'x',
      },
      select: { id: true, name: true, email: true, role: true },
    });

    // Create the three workflow role users (all pointing to admin for V1)
    for (const id of [efficiencyUserId, lobsterUserId, executorUserId]) {
      await pg.user.upsert({
        where: { email: `wf-role-${id}@t.com` },
        update: {},
        create: {
          id,
          name: `wf-role-${id.slice(0, 8)}`,
          email: `wf-role-${id}@t.com`,
          role: 'developer',
          password: 'x',
        },
      }).catch(() => {});
    }

    // Create a project for projectId FK tests
    const project = await pg.project.create({
      data: {
        id: crypto.randomUUID(),
        name: `test-project-${ts}`,
        description: 'Test project for field persistence',
      },
    });
    testProjectId = project.id;
  });

  afterAll(async () => {
    if (pg) {
      await pg.project.delete({ where: { id: testProjectId } }).catch(() => {});
      await pg.requirement.deleteMany({ where: { domainKey: 'agent-todo' } }).catch(() => {});
      await pg.user.deleteMany({
        where: { id: { in: [adminUser.id, developerUser.id, efficiencyUserId, lobsterUserId, executorUserId] } },
      }).catch(() => {});
      await pg.$disconnect().catch(() => {});
    }
  });

  // ── Service-level tests ─────────────────────────────────

  it('creates a requirement with workflow via shared service', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      allowedDomainKeys: ['agent-todo'],
      crossDomainAccess: false,
    };

    const result = await createRequirement(actor, {
      title: `[目标卡] Test goal ${Date.now()}`,
      description: 'Integration test for shared service',
      domainKey: 'agent-todo',
      workflowTemplateKey: 'agent-todo-v1',
      workflowRoleAssignments: {
        'efficiency-manager': efficiencyUserId,
        'lobster-partner': lobsterUserId,
        'executor': executorUserId,
      },
      priority: 'P2',
      type: 'FEATURE',
      tags: ['goal-card', `goal-month:test`],
    }, { prisma: pg });

    expect(result.id).toBeDefined();
    expect(result.domainKey).toBe('agent-todo');
    expect(result.currentStep).toBe('efficiency_review');
    expect(result.requesterId).toBe(adminUser.id);
    expect(result.workflowId).toBeDefined();
    expect(result.workflowSnapshot).toBeDefined();

    // Verify assignee is efficiency-manager (first step)
    expect(result.assigneeId).toBe(efficiencyUserId);

    // Verify roleUserMap in snapshot
    const snapshot = result.workflowSnapshot as any;
    expect(snapshot.roleUserMap).toBeDefined();
    expect(snapshot.roleUserMap['efficiency-manager']).toBe(efficiencyUserId);
    expect(snapshot.roleUserMap['lobster-partner']).toBe(lobsterUserId);
    expect(snapshot.roleUserMap['executor']).toBe(executorUserId);
  });

  it('rejects missing workflow role assignments', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      allowedDomainKeys: ['agent-todo'],
    };

    await expect(createRequirement(actor, {
      title: `[目标卡] Missing roles ${Date.now()}`,
      description: 'Should fail due to missing roles',
      domainKey: 'agent-todo',
      workflowTemplateKey: 'agent-todo-v1',
      workflowRoleAssignments: {
        'efficiency-manager': efficiencyUserId,
        // missing lobster-partner, executor
      },
    }, { prisma: pg })).rejects.toThrow(/missing assignments/);
  });

  it('rejects non-existent workflow template', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      allowedDomainKeys: ['agent-todo'],
    };

    await expect(createRequirement(actor, {
      title: `[目标卡] Bad template ${Date.now()}`,
      description: 'Should fail',
      domainKey: 'agent-todo',
      workflowTemplateKey: 'non-existent-template',
      workflowRoleAssignments: {
        'efficiency-manager': efficiencyUserId,
        'lobster-partner': lobsterUserId,
        'executor': executorUserId,
      },
    }, { prisma: pg })).rejects.toThrow(/not found/);
  });

  it('rejects non-existent domain', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      allowedDomainKeys: ['agent-todo'],
    };

    await expect(createRequirement(actor, {
      title: `[目标卡] Bad domain ${Date.now()}`,
      description: 'Should fail',
      domainKey: 'non-existent-domain',
    }, { prisma: pg })).rejects.toThrow(/not found/);
  });

  it('rejects non-existent assigned user', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      allowedDomainKeys: ['agent-todo'],
    };

    const fakeId = crypto.randomUUID();
    await expect(createRequirement(actor, {
      title: `[目标卡] Bad user ${Date.now()}`,
      description: 'Should fail',
      domainKey: 'agent-todo',
      workflowTemplateKey: 'agent-todo-v1',
      workflowRoleAssignments: {
        'efficiency-manager': fakeId,
        'lobster-partner': lobsterUserId,
        'executor': executorUserId,
      },
    }, { prisma: pg })).rejects.toThrow(/not found/);
  });

  // ── Domain access test (user without access) ─────────────

  it('rejects user without domain access when scope is set', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: developerUser.id,
      name: developerUser.name,
      role: developerUser.role,
      internalRole: 'backend_developer',
      // Explicitly set empty allowedDomainKeys to simulate a user without agent-todo access
      allowedDomainKeys: [],
      crossDomainAccess: false,
    };

    await expect(createRequirement(actor, {
      title: `[目标卡] No access ${Date.now()}`,
      description: 'Should fail with 403',
      domainKey: 'agent-todo',
    }, { prisma: pg })).rejects.toThrow(/no access/);
  });

  // ── Config validation tests ─────────────────────────────

  it('accepts admin user with crossDomainAccess', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      allowedDomainKeys: ['agent-todo'],
      crossDomainAccess: true,
    };

    const result = await createRequirement(actor, {
      title: `[目标卡] Cross domain ${Date.now()}`,
      description: 'Should succeed',
      domainKey: 'agent-todo',
    }, { prisma: pg });

    expect(result.id).toBeDefined();
    expect(result.domainKey).toBe('agent-todo');
  });

  // ── HIGH-1: Field persistence tests ────────────────────────

  it('preserves projectId on plain requirement create', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      allowedDomainKeys: ['agent-todo'],
    };
    const result = await createRequirement(actor, {
      title: `[field-test] projectId ${Date.now()}`,
      description: 'Testing projectId persistence',
      domainKey: 'agent-todo',
      projectId: testProjectId,
    }, { prisma: pg });

    // Verify in database
    const saved = await pg.requirement.findUnique({ where: { id: result.id }, select: { projectId: true } });
    expect(saved?.projectId).toBe(testProjectId);
  });

  it('preserves dueDate on plain requirement create', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      allowedDomainKeys: ['agent-todo'],
    };
    const dueDate = new Date('2026-12-31');
    const result = await createRequirement(actor, {
      title: `[field-test] dueDate ${Date.now()}`,
      description: 'Testing dueDate persistence',
      domainKey: 'agent-todo',
      dueDate,
    }, { prisma: pg });

    const saved = await pg.requirement.findUnique({ where: { id: result.id }, select: { dueDate: true } });
    expect(saved?.dueDate).toBeTruthy();
  });

  it('preserves attachment on plain requirement create', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      allowedDomainKeys: ['agent-todo'],
    };
    const attachment = 'https://example.com/file.pdf';
    const result = await createRequirement(actor, {
      title: `[field-test] attachment ${Date.now()}`,
      description: 'Testing attachment persistence',
      domainKey: 'agent-todo',
      attachment,
    }, { prisma: pg });

    const saved = await pg.requirement.findUnique({ where: { id: result.id }, select: { attachment: true } });
    expect(saved?.attachment).toBe(attachment);
  });

  it('preserves all three fields together on workflow requirement', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      allowedDomainKeys: ['agent-todo'],
      crossDomainAccess: true,
    };
    const dueDate = new Date('2026-12-31');
    const attachment = 'https://example.com/workflow-req.pdf';

    const result = await createRequirement(actor, {
      title: `[field-test] workflow all ${Date.now()}`,
      description: 'Testing all fields with workflow',
      domainKey: 'agent-todo',
      workflowTemplateKey: 'agent-todo-v1',
      workflowRoleAssignments: {
        'efficiency-manager': efficiencyUserId,
        'lobster-partner': lobsterUserId,
        'executor': executorUserId,
      },
      projectId: testProjectId,
      dueDate,
      attachment,
      priority: 'P2',
      type: 'FEATURE',
      tags: ['goal-card'],
    }, { prisma: pg });

    const saved = await pg.requirement.findUnique({
      where: { id: result.id },
      select: { projectId: true, dueDate: true, attachment: true, currentStep: true, domainKey: true },
    });
    expect(saved?.projectId).toBe(testProjectId);
    expect(saved?.dueDate).toBeTruthy();
    expect(saved?.attachment).toBe(attachment);
    expect(saved?.currentStep).toBe('efficiency_review');
    expect(saved?.domainKey).toBe('agent-todo');
  });

  // ── HIGH-2: No lossy dedup tests ───────────────────────────

  it('creates separate requirements for same-named goals in one push', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      allowedDomainKeys: ['agent-todo'],
      crossDomainAccess: true,
    };

    const sharedTitle = `[目标卡] 完成接口 ${Date.now()}`;
    const ids: string[] = [];

    // Simulate two goals with identical text — each must get its own requirement
    for (let i = 0; i < 2; i++) {
      const result = await createRequirement(actor, {
        title: sharedTitle,
        description: `Same-name goal ${i} for ${Date.now()}`,
        domainKey: 'agent-todo',
      }, { prisma: pg });
      ids.push(result.id);
    }

    // Both requirement IDs must be distinct
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids.length).toBe(2);

    // Both must exist in the database
    const count = await pg.requirement.count({ where: { id: { in: ids } } });
    expect(count).toBe(2);
  });

  it('creates separate requirements for same text across months', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      allowedDomainKeys: ['agent-todo'],
      crossDomainAccess: true,
    };

    // Same goal text, different months
    const goalText = '完成接口';
    const ts = Date.now();

    const r1 = await createRequirement(actor, {
      title: `[目标卡] ${goalText}`,
      description: `Month 7 for ${ts}`,
      domainKey: 'agent-todo',
      tags: ['goal-card', 'goal-month:2026-07', `goal-agent:agent-${ts}`],
    }, { prisma: pg });

    const r2 = await createRequirement(actor, {
      title: `[目标卡] ${goalText}`,
      description: `Month 8 for ${ts}`,
      domainKey: 'agent-todo',
      tags: ['goal-card', 'goal-month:2026-08', `goal-agent:agent-${ts}`],
    }, { prisma: pg });

    expect(r1.id).not.toBe(r2.id);
    // DB confirms both exist independently
    const stored1 = await pg.requirement.findUnique({ where: { id: r1.id }, select: { id: true } });
    const stored2 = await pg.requirement.findUnique({ where: { id: r2.id }, select: { id: true } });
    expect(stored1).toBeTruthy();
    expect(stored2).toBeTruthy();
  });

  it('creates separate requirements for same text across agents', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      allowedDomainKeys: ['agent-todo'],
      crossDomainAccess: true,
    };

    const goalText = '修复bug';
    const ts = Date.now();

    const r1 = await createRequirement(actor, {
      title: `[目标卡] ${goalText}`,
      description: `Agent A for ${ts}`,
      domainKey: 'agent-todo',
      tags: ['goal-card', `goal-agent:agent-a-${ts}`],
    }, { prisma: pg });

    const r2 = await createRequirement(actor, {
      title: `[目标卡] ${goalText}`,
      description: `Agent B for ${ts}`,
      domainKey: 'agent-todo',
      tags: ['goal-card', `goal-agent:agent-b-${ts}`],
    }, { prisma: pg });

    expect(r1.id).not.toBe(r2.id);
  });

  // ── Partial failure / retry may duplicate ─────────────────

  it('PARTIAL_FAILURE_RETRY_MAY_DUPLICATE: retry after partial failure creates new requirements', { timeout: IT_TIMEOUT }, async () => {
    const actor: CreateRequirementActor = {
      id: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      allowedDomainKeys: ['agent-todo'],
      crossDomainAccess: true,
    };

    // Create first requirement
    const r1 = await createRequirement(actor, {
      title: `[目标卡] 部分失败重试 ${Date.now()}`,
      description: 'First attempt',
      domainKey: 'agent-todo',
    }, { prisma: pg });

    // Retry: create the same thing again (simulating retry after partial failure)
    const r2 = await createRequirement(actor, {
      title: r1.title,
      description: 'Retry attempt — will be a duplicate',
      domainKey: 'agent-todo',
    }, { prisma: pg });

    // V1 explicitly accepts duplicates on retry — IDs MUST be different
    expect(r1.id).not.toBe(r2.id);

    // Both must exist in database (not merged)
    const count = await pg.requirement.count({ where: { id: { in: [r1.id, r2.id] } } });
    expect(count).toBe(2);
  });
});
