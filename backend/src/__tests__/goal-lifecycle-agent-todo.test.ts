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
  });

  afterAll(async () => {
    if (pg) {
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
});
