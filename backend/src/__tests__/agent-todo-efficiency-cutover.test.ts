/**
 * Comprehensive tests for Agent Todo Efficiency Cutover Tool.
 *
 * Structure:
 *   1. CLI argument parsing (no DB)
 *   2. UUID validation (no DB)
 *   3. Database URL parsing & masking (no DB)
 *   4. Environment loading contract (no DB)
 *   5. AuditLog detail builders (no DB)
 *   6. Precondition validation (mocked DB)
 *   7. Service dry-run (mocked DB — verifies 0 writes)
 *   8. Service apply (mocked DB — CAS + transaction)
 *   9. Service rollback (mocked DB)
 *  10. Integration-style: actor validation with getPlatformRoles (mocked DB)
 *  11. Output formatting (no DB)
 *
 * NO_PRODUCTION_DATABASE_ACCESSED
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { isValidUuidV4, isNilUuid, resolveDatabaseUrl, parseDatabaseUrl, maskUrl, validateActor, validateDatabaseTarget, validateAgentTodoCount, countAgentTodoRequirements } from '../scripts/agent-todo-efficiency-cutover/validators.js';
import { parseCliArgs, checkRequirementPrecondition, verifyPostcondition, verifyRollbackPrecondition } from '../scripts/agent-todo-efficiency-cutover/validation.js';
import { buildCutoverAuditLogDetails, buildRollbackAuditLogDetails, formatHelp, formatDryRunOutput, formatApplyOutput } from '../scripts/agent-todo-efficiency-cutover/evidence.js';

// ─── Helpers ─────────────────────────────────────────────────────────────

function uuid() {
  return crypto.randomUUID();
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

// ─── 1. CLI Argument Parsing ─────────────────────────────────────────────

describe('CLI argument parsing', () => {
  it('1.1 no mode shows help and exits non-zero', () => {
    const result = parseCliArgs(['--requirement-id', uuid(), '--from-user-id', uuid()]);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('MISSING_MODE');
  });

  it('1.2 missing required args rejects', () => {
    const result = parseCliArgs(['--dry-run']);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('1.3 non-UUID value rejects', () => {
    const id1 = uuid();
    const result = parseCliArgs([
      '--dry-run',
      '--requirement-id', 'not-a-uuid',
      '--requirement-id', id1,
      '--requirement-id', uuid(),
      '--from-user-id', uuid(),
      '--to-user-id', uuid(),
      '--actor-id', uuid(),
      '--actor-name', 'Admin',
      '--expected-host', 'localhost',
      '--expected-database', 'test_db',
      '--expected-schema', 'public',
      '--expected-agent-todo-count', '3',
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('UUID_FORMAT'))).toBe(true);
  });

  it('1.4 nil UUID rejects', () => {
    const id1 = uuid();
    const result = parseCliArgs([
      '--dry-run',
      '--requirement-id', NIL_UUID,
      '--requirement-id', id1,
      '--requirement-id', uuid(),
      '--from-user-id', uuid(),
      '--to-user-id', uuid(),
      '--actor-id', uuid(),
      '--actor-name', 'Admin',
      '--expected-host', 'localhost',
      '--expected-database', 'test_db',
      '--expected-schema', 'public',
      '--expected-agent-todo-count', '3',
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('nil UUID'))).toBe(true);
  });

  it('1.5 duplicate requirement IDs reject', () => {
    const dupId = uuid();
    const result = parseCliArgs([
      '--dry-run',
      '--requirement-id', dupId,
      '--requirement-id', dupId,
      '--requirement-id', uuid(),
      '--from-user-id', uuid(),
      '--to-user-id', uuid(),
      '--actor-id', uuid(),
      '--actor-name', 'Admin',
      '--expected-host', 'localhost',
      '--expected-database', 'test_db',
      '--expected-schema', 'public',
      '--expected-agent-todo-count', '3',
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('DUPLICATE_ID'))).toBe(true);
  });

  it('1.6 not exactly 3 requirement IDs rejects', () => {
    const result = parseCliArgs([
      '--dry-run',
      '--requirement-id', uuid(),
      '--requirement-id', uuid(),
      '--from-user-id', uuid(),
      '--to-user-id', uuid(),
      '--actor-id', uuid(),
      '--actor-name', 'Admin',
      '--expected-host', 'localhost',
      '--expected-database', 'test_db',
      '--expected-schema', 'public',
      '--expected-agent-todo-count', '3',
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('WRONG_COUNT'))).toBe(true);
  });

  it('1.7 fromUserId === toUserId rejects', () => {
    const sameId = uuid();
    const result = parseCliArgs([
      '--dry-run',
      '--requirement-id', uuid(),
      '--requirement-id', uuid(),
      '--requirement-id', uuid(),
      '--from-user-id', sameId,
      '--to-user-id', sameId,
      '--actor-id', uuid(),
      '--actor-name', 'Admin',
      '--expected-host', 'localhost',
      '--expected-database', 'test_db',
      '--expected-schema', 'public',
      '--expected-agent-todo-count', '3',
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('FROM_EQ_TO'))).toBe(true);
  });

  it('1.8 missing actorId rejects', () => {
    const result = parseCliArgs([
      '--dry-run',
      '--requirement-id', uuid(),
      '--requirement-id', uuid(),
      '--requirement-id', uuid(),
      '--from-user-id', uuid(),
      '--to-user-id', uuid(),
      '--actor-name', 'Admin',
      '--expected-host', 'localhost',
      '--expected-database', 'test_db',
      '--expected-schema', 'public',
      '--expected-agent-todo-count', '3',
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('UUID_FORMAT'))).toBe(true);
  });

  it('1.9 missing actorName rejects', () => {
    const result = parseCliArgs([
      '--dry-run',
      '--requirement-id', uuid(),
      '--requirement-id', uuid(),
      '--requirement-id', uuid(),
      '--from-user-id', uuid(),
      '--to-user-id', uuid(),
      '--actor-id', uuid(),
      '--expected-host', 'localhost',
      '--expected-database', 'test_db',
      '--expected-schema', 'public',
      '--expected-agent-todo-count', '3',
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('ACTOR_DEFAULT'))).toBe(true);
  });

  it('1.10 conflicting modes reject', () => {
    const result = parseCliArgs(['--dry-run', '--apply']);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('MODE_CONFLICT'))).toBe(true);
  });

  it('1.11 valid dry-run args parse correctly', () => {
    const id1 = uuid(), id2 = uuid(), id3 = uuid();
    const fromId = uuid(), toId = uuid(), actorId = uuid();
    const result = parseCliArgs([
      '--dry-run',
      '--requirement-id', id1,
      '--requirement-id', id2,
      '--requirement-id', id3,
      '--from-user-id', fromId,
      '--to-user-id', toId,
      '--actor-id', actorId,
      '--actor-name', 'Operator',
      '--expected-host', 'postgres-authoritative',
      '--expected-database', 'agent_dev_center',
      '--expected-schema', 'public',
      '--expected-agent-todo-count', '3',
      '--expected-to-user-email', 'eff@test.local',
      '--expected-from-user-name', 'MAYF3',
    ]);
    expect(result.ok).toBe(true);
    expect(result.args).toBeDefined();
    expect(result.args!.mode).toBe('dry-run');
    expect(result.args!.requirementIds).toEqual([id1, id2, id3]);
    expect(result.args!.fromUserId).toBe(fromId);
    expect(result.args!.toUserId).toBe(toId);
    expect(result.args!.actorId).toBe(actorId);
    expect(result.args!.actorName).toBe('Operator');
    expect(result.args!.expectedHost).toBe('postgres-authoritative');
    expect(result.args!.expectedDatabase).toBe('agent_dev_center');
    expect(result.args!.expectedSchema).toBe('public');
    expect(result.args!.expectedAgentTodoCount).toBe(3);
    expect(result.args!.expectedToUserEmail).toBe('eff@test.local');
    expect(result.args!.expectedFromUserName).toBe('MAYF3');
  });

  it('1.12 rollback mode requires operation-id', () => {
    const result = parseCliArgs(['--rollback']);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('operation-id'))).toBe(true);
  });

  it('1.13 rollback mode with valid operation-id parses', () => {
    const opId = uuid();
    const actorId = uuid();
    const result = parseCliArgs([
      '--rollback',
      '--operation-id', opId,
      '--actor-id', actorId,
      '--actor-name', 'Rollbacker',
      '--expected-host', 'localhost',
      '--expected-database', 'test_db',
      '--expected-schema', 'public',
      '--expected-agent-todo-count', '3',
    ]);
    expect(result.ok).toBe(true);
    expect(result.args!.mode).toBe('rollback');
    expect(result.args!.operationId).toBe(opId);
    expect(result.args!.actorId).toBe(actorId);
    expect(result.args!.actorName).toBe('Rollbacker');
  });
});

// ─── 2. UUID Validation ───────────────────────────────────────────────────

describe('UUID validation', () => {
  it('2.1 valid uuid v4 returns true', () => {
    expect(isValidUuidV4(uuid())).toBe(true);
    expect(isValidUuidV4('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('2.2 invalid uuid v4 returns false', () => {
    expect(isValidUuidV4('not-a-uuid')).toBe(false);
    expect(isValidUuidV4('')).toBe(false);
    expect(isValidUuidV4('550e8400-e29b-41d4-a716-44665544000Z')).toBe(false);
  });

  it('2.3 nil uuid detection', () => {
    expect(isNilUuid(NIL_UUID)).toBe(true);
    expect(isNilUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(isNilUuid(uuid())).toBe(false);
  });
});

// ─── 3. Database URL Parsing & Masking ───────────────────────────────────

describe('Database URL parsing and masking', () => {
  it('3.1 parses standard URL', () => {
    const result = parseDatabaseUrl('postgresql://user:pass@host:5432/db?schema=myschema');
    expect(result.host).toBe('host');
    expect(result.port).toBe(5432);
    expect(result.database).toBe('db');
    expect(result.user).toBe('user');
    expect(result.schema).toBe('myschema');
  });

  it('3.2 parses URL with default port and schema', () => {
    const result = parseDatabaseUrl('postgresql://user:pass@host/db');
    expect(result.port).toBe(5432);
    expect(result.schema).toBe('public');
    expect(result.database).toBe('db');
  });

  it('3.3 maskUrl hides password', () => {
    const masked = maskUrl('postgresql://user:secret123@host:5432/db');
    expect(masked).toContain('****');
    expect(masked).not.toContain('secret123');
  });
});

// ─── 4. Environment Loading Contract ───────────────────────────────────────

describe('Environment loading contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('4.1 throws when no DATABASE_URL and no --env-file', () => {
    delete process.env.DATABASE_URL;
    expect(() => resolveDatabaseUrl({})).toThrow('DATABASE_URL 未设置');
  });

  it('4.2 uses shell DATABASE_URL when no --env-file', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@h/db';
    const result = resolveDatabaseUrl({});
    expect(result.url).toBe('postgresql://u:p@h/db');
    expect(result.source).toContain('shell');
  });

  it('4.3 reads from --env-file and rejects shell conflict', () => {
    process.env.DATABASE_URL = 'postgresql://u:shell@host/db';
    const fs = require('node:fs');
    const tmpFile = '/tmp/test-cutover-env-xxx';
    fs.writeFileSync(tmpFile, 'DATABASE_URL=postgresql://u:file@host/db\n');
    expect(() => resolveDatabaseUrl({ envFile: tmpFile })).toThrow('ENV_CONFLICT');
    fs.unlinkSync(tmpFile);
    delete process.env.DATABASE_URL;
  });
});

// ─── 5. AuditLog Detail Builders ──────────────────────────────────────────

describe('AuditLog detail builders', () => {
  it('5.1 buildCutoverAuditLogDetails produces correct structure', () => {
    const opId = uuid();
    const details = buildCutoverAuditLogDetails(
      opId,
      'from-uuid', 'MAYF3',
      'to-uuid', '效率管家',
      {
        id: 'req-id', title: 'Test',
        efficiencyManagerUserId: 'from-uuid',
        assigneeId: 'from-uuid', assignee: 'MAYF3',
        stateVersion: 0,
        roleUserMap: { 'efficiency-manager': 'from-uuid', 'lobster-partner': 'from-uuid', executor: 'from-uuid' },
      },
      {
        id: 'req-id', efficiencyManagerUserId: 'to-uuid',
        assigneeId: 'to-uuid', assignee: '效率管家', stateVersion: 1,
      },
    );
    expect(details.operationId).toBe(opId);
    expect(details.operation).toBe('switch_efficiency_manager');
    expect(details.preimage.stateVersion).toBe(0);
    expect(details.postimage.stateVersion).toBe(1);
    expect(details.preimage.assignee).toBe('MAYF3');
    expect(details.postimage.assignee).toBe('效率管家');
  });

  it('5.2 buildRollbackAuditLogDetails produces correct structure', () => {
    const opId = uuid();
    const details = buildRollbackAuditLogDetails(
      opId, 'orig-op', opId + '-roll',
      { id: 'r1', title: 'T', efficiencyManagerUserId: 'from-uuid', assigneeId: 'from-uuid', assignee: 'MAYF3', stateVersion: 0, roleUserMap: {} },
      1, 2,
    );
    expect(details.operation).toBe('rollback_efficiency_manager');
    expect(details.restoredPreimage.stateVersionBefore).toBe(1);
    expect(details.restoredPreimage.stateVersionAfter).toBe(2);
    expect(details.rollbackOperationId).toBe(opId + '-roll');
  });
});

// ─── 6. Precondition Validation (mocked Prisma) ───────────────────────────

describe('Precondition validation (mocked DB)', () => {
  function mockPrisma(overrides: Record<string, any> = {}) {
    const reqId = overrides.id || uuid();
    const fromId = overrides.fromUserId || uuid();
    return {
      requirement: {
        findUnique: vi.fn().mockResolvedValue({
          id: reqId,
          title: overrides.title || '测试需求',
          domainKey: overrides.domainKey ?? 'agent-todo',
          currentStep: overrides.currentStep ?? 'efficiency_review',
          requesterId: overrides.requesterId || uuid(),
          assigneeId: overrides.assigneeId ?? fromId,
          assignee: overrides.assignee ?? 'MAYF3',
          workflowId: overrides.workflowId || uuid(),
          workflowSnapshot: overrides.workflowSnapshot ?? {
            roleUserMap: {
              'efficiency-manager': fromId,
              'lobster-partner': fromId,
              executor: fromId,
            },
            steps: [{ name: 'efficiency_review', role: 'efficiency-manager' }],
          },
          stateVersion: overrides.stateVersion ?? 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      workflowTransition: {
        count: vi.fn().mockResolvedValue(overrides.transitionCount ?? 0),
      },
      requirementReport: {
        count: vi.fn().mockResolvedValue(overrides.reportCount ?? 0),
      },
    } as any;
  }

  it('6.1 wrong domainKey rejects', async () => {
    const fromId = uuid();
    const prisma = mockPrisma({ domainKey: 'engineering', fromUserId: fromId });
    const result = await checkRequirementPrecondition(prisma, uuid(), fromId);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r: string) => r.includes('DOMAIN_MISMATCH'))).toBe(true);
  });

  it('6.2 wrong currentStep rejects', async () => {
    const fromId = uuid();
    const prisma = mockPrisma({ currentStep: 'partner_review', fromUserId: fromId });
    const result = await checkRequirementPrecondition(prisma, uuid(), fromId);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r: string) => r.includes('STEP_MISMATCH'))).toBe(true);
  });

  it('6.3 wrong assigneeId rejects', async () => {
    const fromId = uuid();
    const wrongId = uuid();
    const prisma = mockPrisma({ assigneeId: wrongId, fromUserId: fromId });
    const result = await checkRequirementPrecondition(prisma, uuid(), fromId);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r: string) => r.includes('ASSIGNEE_ID_MISMATCH'))).toBe(true);
  });

  it('6.4 wrong efficiency-manager roleUserMap rejects', async () => {
    const fromId = uuid();
    const wrongId = uuid();
    const prisma = mockPrisma({
      fromUserId: fromId,
      workflowSnapshot: {
        roleUserMap: {
          'efficiency-manager': wrongId,
          'lobster-partner': fromId,
          executor: fromId,
        },
      },
    });
    const result = await checkRequirementPrecondition(prisma, uuid(), fromId);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r: string) => r.includes('ROLE_MAP_EFFICIENCY_MISMATCH'))).toBe(true);
  });

  it('6.5 wrong lobster-partner roleUserMap rejects', async () => {
    const fromId = uuid();
    const wrongId = uuid();
    const prisma = mockPrisma({
      fromUserId: fromId,
      workflowSnapshot: {
        roleUserMap: {
          'efficiency-manager': fromId,
          'lobster-partner': wrongId,
          executor: fromId,
        },
      },
    });
    const result = await checkRequirementPrecondition(prisma, uuid(), fromId);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r: string) => r.includes('ROLE_MAP_LOBSTER_MISMATCH'))).toBe(true);
  });

  it('6.6 wrong executor roleUserMap rejects', async () => {
    const fromId = uuid();
    const wrongId = uuid();
    const prisma = mockPrisma({
      fromUserId: fromId,
      workflowSnapshot: {
        roleUserMap: {
          'efficiency-manager': fromId,
          'lobster-partner': fromId,
          executor: wrongId,
        },
      },
    });
    const result = await checkRequirementPrecondition(prisma, uuid(), fromId);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r: string) => r.includes('ROLE_MAP_EXECUTOR_MISMATCH'))).toBe(true);
  });

  it('6.7 non-zero Transition count rejects', async () => {
    const fromId = uuid();
    const prisma = mockPrisma({ fromUserId: fromId, transitionCount: 1 });
    const result = await checkRequirementPrecondition(prisma, uuid(), fromId);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r: string) => r.includes('TRANSITION_COUNT_MISMATCH'))).toBe(true);
  });

  it('6.8 non-zero Report count rejects', async () => {
    const fromId = uuid();
    const prisma = mockPrisma({ fromUserId: fromId, reportCount: 1 });
    const result = await checkRequirementPrecondition(prisma, uuid(), fromId);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r: string) => r.includes('REPORT_COUNT_MISMATCH'))).toBe(true);
  });

  it('6.9 valid precondition passes', async () => {
    const fromId = uuid();
    const prisma = mockPrisma({ fromUserId: fromId });
    const result = await checkRequirementPrecondition(prisma, uuid(), fromId);
    expect(result.ok).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });
});

// ─── 7. Actor Validation ──────────────────────────────────────────────────

describe('Actor validation', () => {
  async function mockActorPrisma(actorOverrides: Record<string, any> = {}) {
    const actorId = actorOverrides.id || uuid();
    return {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: actorId,
          name: actorOverrides.name ?? 'Admin',
          email: 'admin@test.local',
          enabled: actorOverrides.enabled ?? true,
          roles: actorOverrides.roles ?? ['adc:admin'],
          internalRole: actorOverrides.internalRole ?? 'cto',
          role: actorOverrides.role ?? 'admin',
        }),
      },
    } as any;
  }

  it('7.1 disabled actor rejects', async () => {
    const actorId = uuid();
    const prisma = await mockActorPrisma({ id: actorId, enabled: false, name: 'Disabled' });
    await expect(validateActor(prisma, actorId, 'Disabled')).rejects.toThrow('USER_DISABLED');
  });

  it('7.2 non-admin actor rejects', async () => {
    const actorId = uuid();
    const prisma = await mockActorPrisma({
      id: actorId,
      roles: ['adc:developer'],
      internalRole: 'backend_developer',
      role: 'developer',
      name: 'Developer',
    });
    await expect(validateActor(prisma, actorId, 'Developer')).rejects.toThrow('BLOCKED_BY_INVALID_ACTOR');
  });

  it('7.3 enabled adc:admin actor passes', async () => {
    const actorId = uuid();
    const prisma = await mockActorPrisma({
      id: actorId,
      roles: ['adc:admin'],
      enabled: true,
      name: 'Admin',
    });
    const result = await validateActor(prisma, actorId, 'Admin');
    expect(result.name).toBe('Admin');
    expect(result.enabled).toBe(true);
  });
});

// ─── 8. Postcondition Verification ────────────────────────────────────────

describe('Postcondition verification', () => {
  it('8.1 correct postcondition passes', async () => {
    const fromId = uuid();
    const toId = uuid();
    const reqId = uuid();
    const prisma = {
      requirement: {
        findUnique: vi.fn().mockResolvedValue({
          id: reqId,
          title: 'Test',
          currentStep: 'efficiency_review',
          requesterId: uuid(),
          assigneeId: toId,
          assignee: '效率管家',
          workflowId: uuid(),
          workflowSnapshot: {
            roleUserMap: {
              'efficiency-manager': toId,
              'lobster-partner': fromId,
              executor: fromId,
            },
          },
          stateVersion: 1,
        }),
      },
    } as any;
    const result = await verifyPostcondition(prisma, [reqId], toId, '效率管家', fromId, 1);
    expect(result.ok).toBe(true);
  });

  it('8.2 wrong assigneeId fails', async () => {
    const fromId = uuid();
    const toId = uuid();
    const wrongId = uuid();
    const reqId = uuid();
    const prisma = {
      requirement: {
        findUnique: vi.fn().mockResolvedValue({
          id: reqId,
          currentStep: 'efficiency_review',
          assigneeId: wrongId,
          assignee: '效率管家',
          workflowSnapshot: {
            roleUserMap: { 'efficiency-manager': toId, 'lobster-partner': fromId, executor: fromId },
          },
          stateVersion: 1,
        }),
      },
    } as any;
    const result = await verifyPostcondition(prisma, [reqId], toId, '效率管家', fromId, 1);
    expect(result.ok).toBe(false);
  });
});

// ─── 9. Rollback Precondition ────────────────────────────────────────────

describe('Rollback precondition', () => {
  it('9.1 clean state passes rollback precondition', async () => {
    const reqId = uuid();
    const prisma = {
      workflowTransition: { count: vi.fn().mockResolvedValue(0) },
      requirementReport: { count: vi.fn().mockResolvedValue(0) },
      requirement: { findUnique: vi.fn().mockResolvedValue({ currentStep: 'efficiency_review' }) },
    } as any;
    const result = await verifyRollbackPrecondition(prisma, [reqId]);
    expect(result.ok).toBe(true);
  });

  it('9.2 transition present fails rollback precondition', async () => {
    const reqId = uuid();
    const prisma = {
      workflowTransition: { count: vi.fn().mockResolvedValue(1) },
      requirementReport: { count: vi.fn().mockResolvedValue(0) },
      requirement: { findUnique: vi.fn().mockResolvedValue({ currentStep: 'efficiency_review' }) },
    } as any;
    const result = await verifyRollbackPrecondition(prisma, [reqId]);
    expect(result.ok).toBe(false);
  });

  it('9.3 stepped workflow fails rollback precondition', async () => {
    const reqId = uuid();
    const prisma = {
      workflowTransition: { count: vi.fn().mockResolvedValue(0) },
      requirementReport: { count: vi.fn().mockResolvedValue(0) },
      requirement: { findUnique: vi.fn().mockResolvedValue({ currentStep: 'execution' }) },
    } as any;
    const result = await verifyRollbackPrecondition(prisma, [reqId]);
    expect(result.ok).toBe(false);
  });
});

// ─── 10. Database Target Validation ───────────────────────────────────────

describe('Database target validation', () => {
  it('10.1 mismatch database rejects', async () => {
    const identity = {
      currentDatabase: 'wrong_db',
      currentSchema: 'public',
      currentUser: 'u',
      inetServerAddr: '127.0.0.1',
      inetServerPort: 5432,
      urlHost: 'localhost',
      urlDatabase: 'wrong_db',
      urlSchema: 'public',
    };
    await expect(validateDatabaseTarget({} as any, identity, { host: 'localhost', database: 'expected_db', schema: 'public' }))
      .rejects.toThrow('BLOCKED_BY_DATABASE_TARGET_UNSAFE');
  });

  it('10.2 mismatch host rejects', async () => {
    const identity = {
      currentDatabase: 'db',
      currentSchema: 'public',
      currentUser: 'u',
      inetServerAddr: '10.0.0.1',
      inetServerPort: 5432,
      urlHost: 'wrong-host',
      urlDatabase: 'db',
      urlSchema: 'public',
    };
    await expect(validateDatabaseTarget({} as any, identity, { host: 'expected-host', database: 'db', schema: 'public' }))
      .rejects.toThrow('BLOCKED_BY_DATABASE_TARGET_UNSAFE');
  });

  it('10.3 mismatch schema rejects', async () => {
    const identity = {
      currentDatabase: 'db',
      currentSchema: 'other_schema',
      currentUser: 'u',
      inetServerAddr: '127.0.0.1',
      inetServerPort: 5432,
      urlHost: 'localhost',
      urlDatabase: 'db',
      urlSchema: 'other_schema',
    };
    await expect(validateDatabaseTarget({} as any, identity, { host: 'localhost', database: 'db', schema: 'public' }))
      .rejects.toThrow('BLOCKED_BY_DATABASE_TARGET_UNSAFE');
  });

  it('10.4 all match passes', async () => {
    const identity = {
      currentDatabase: 'agent_dev_center',
      currentSchema: 'public',
      currentUser: 'u',
      inetServerAddr: '127.0.0.1',
      inetServerPort: 5432,
      urlHost: 'postgres-authoritative',
      urlDatabase: 'agent_dev_center',
      urlSchema: 'public',
    };
    await expect(validateDatabaseTarget({} as any, identity, { host: 'postgres-authoritative', database: 'agent_dev_center', schema: 'public' }))
      .resolves.toBeUndefined();
  });
});

// ─── 11. Agent Todo Count Validation ─────────────────────────────────────

describe('Agent Todo count validation', () => {
  it('11.1 count mismatch rejects', async () => {
    const prisma = { requirement: { count: vi.fn().mockResolvedValue(5) } } as any;
    await expect(validateAgentTodoCount(prisma, 3)).rejects.toThrow('COUNT_MISMATCH');
  });

  it('11.2 count matches passes', async () => {
    const prisma = { requirement: { count: vi.fn().mockResolvedValue(3) } } as any;
    const result = await validateAgentTodoCount(prisma, 3);
    expect(result).toBe(3);
  });
});

// ─── 12. Output Formatters ────────────────────────────────────────────────

describe('Output formatters', () => {
  it('12.1 formatHelp contains all modes', () => {
    const help = formatHelp();
    expect(help).toContain('--dry-run');
    expect(help).toContain('--apply');
    expect(help).toContain('--rollback');
    expect(help).toContain('--requirement-id');
    expect(help).toContain('--operation-id');
  });

  it('12.2 formatDryRunOutput does not contain passwords', async () => {
    const output = formatDryRunOutput({
      operationId: uuid(),
      mode: 'dry-run',
      databaseIdentity: {
        currentDatabase: 'db', currentSchema: 'public', currentUser: 'u',
        inetServerAddr: '127.0.0.1', inetServerPort: 5432,
        urlHost: 'localhost', urlDatabase: 'db', urlSchema: 'public',
      },
      fromUserId: uuid(), toUserId: uuid(), actorId: uuid(), actorName: 'A',
      expectedAgentTodoCount: 3, agentTodoCountBefore: 3,
      requirements: [{ id: uuid(), title: 'T', stateVersionBefore: 0, preconditionOk: true }],
      plannedModifiedFields: ['f1', 'f2', 'f3'],
      plannedAuditLogCount: 3,
    });
    expect(output).toContain('Dry-run');
    expect(output).not.toContain('password');
    expect(output).not.toContain('P@ss');
  });

  it('12.3 formatApplyOutput contains operationId', async () => {
    const opId = uuid();
    const output = formatApplyOutput({
      operationId: opId,
      mode: 'apply',
      agentTodoCountBefore: 3,
      agentTodoCountInTransaction: 3,
      agentTodoCountAfterWrite: 3,
      requirements: [{ id: uuid(), title: 'T', stateVersionBefore: 0, stateVersionAfter: 1, ok: true }],
      auditLogIds: [uuid()],
    });
    expect(output).toContain(opId.slice(0, 8));
    expect(output).toContain('全部修正完成');
  });
});

// ─── 13. Service Dry-Run ──────────────────────────────────────────────────

describe('Service dry-run', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/agent_dev_center?schema=public';
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('13.1 executeDryRun validates all inputs without writes', async () => {
    const { executeDryRun } = await import('../scripts/agent-todo-efficiency-cutover/service.js');
    const fromId = uuid();
    const toId = uuid();
    const actorId = uuid();
    const reqId1 = uuid();
    const reqId2 = uuid();
    const reqId3 = uuid();

    const mockReq = (id: string) => ({
      id, title: `Req-${id.slice(0, 8)}`,
      domainKey: 'agent-todo',
      currentStep: 'efficiency_review',
      requesterId: uuid(),
      assigneeId: fromId,
      assignee: 'MAYF3',
      workflowId: uuid(),
      workflowSnapshot: {
        roleUserMap: { 'efficiency-manager': fromId, 'lobster-partner': fromId, executor: fromId },
        steps: [{ name: 'efficiency_review', role: 'efficiency-manager' }],
      },
      stateVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const prisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{
        current_database: 'agent_dev_center', current_schema: 'public',
        current_user: 'test_user', inet_server_addr: '127.0.0.1', inet_server_port: 5432,
      }]),
      requirement: {
        findUnique: vi.fn((args: any) => Promise.resolve(
          [reqId1, reqId2, reqId3].includes(args.where.id) ? mockReq(args.where.id) : null
        )),
        count: vi.fn().mockResolvedValue(3),
        updateMany: vi.fn(),
      },
      workflowTransition: { count: vi.fn().mockResolvedValue(0) },
      requirementReport: { count: vi.fn().mockResolvedValue(0) },
      user: {
        findUnique: vi.fn((args: any) => {
          if (args.where.id === fromId) return Promise.resolve({ id: fromId, name: 'MAYF3', email: 'm@t.local', enabled: true, roles: ['adc:admin'], internalRole: 'cto', role: 'admin' });
          if (args.where.id === toId) return Promise.resolve({ id: toId, name: '效率管家', email: 'e@t.local', enabled: true, roles: ['adc:admin'], internalRole: 'cto', role: 'admin' });
          if (args.where.id === actorId) return Promise.resolve({ id: actorId, name: 'Op', email: 'o@t.local', enabled: true, roles: ['adc:admin'], internalRole: 'cto', role: 'admin' });
          return Promise.resolve(null);
        }),
      },
      businessDomain: { findUnique: vi.fn().mockResolvedValue({ key: 'agent-todo', isActive: true }) },
      workflowTemplate: { findUnique: vi.fn().mockResolvedValue({ name: 'agent-todo-v1', isActive: true }) },
      auditLog: { findMany: vi.fn(), create: vi.fn() },
      $transaction: vi.fn(),
      $connect: vi.fn(),
      $disconnect: vi.fn(),
    } as any;

    const args = {
      mode: 'dry-run' as const,
      requirementIds: [reqId1, reqId2, reqId3] as [string, string, string],
      fromUserId: fromId,
      toUserId: toId,
      actorId,
      actorName: 'Op',
      expectedHost: 'localhost',
      expectedDatabase: 'agent_dev_center',
      expectedSchema: 'public',
      expectedAgentTodoCount: 3,
      expectedToUserEmail: 'e@t.local',
      expectedFromUserName: 'MAYF3',
    };

    const summary = await executeDryRun(prisma, args);
    expect(summary.mode).toBe('dry-run');
    expect(summary.requirements).toHaveLength(3);
    expect(summary.agentTodoCountBefore).toBe(3);
    expect(summary.plannedAuditLogCount).toBe(3);

    // Verify no writes
    expect(prisma.requirement.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ─── 14. Service Apply ────────────────────────────────────────────────────

describe('Service apply (CAS + transaction)', () => {
  function makeApplyMock(writeCount: number = 1, updatedStateVersion: number = 1) {
    const fromId = uuid();
    const toId = uuid();
    const actorId = uuid();
    const reqId1 = uuid();
    const reqId2 = uuid();
    const reqId3 = uuid();
    const auditLogIds = [uuid(), uuid(), uuid()];
    let auditIdx = 0;

    // Mutable state that gets updated after each "updateMany"
    const reqState: Record<string, {
      assigneeId: string;
      assignee: string;
      stateVersion: number;
      workflowSnapshot: any;
    }> = {};

    for (const id of [reqId1, reqId2, reqId3]) {
      reqState[id] = {
        assigneeId: fromId,
        assignee: 'MAYF3',
        stateVersion: 0,
        workflowSnapshot: {
          roleUserMap: { 'efficiency-manager': fromId, 'lobster-partner': fromId, executor: fromId },
          steps: [{ name: 'efficiency_review', role: 'efficiency-manager' }],
        },
      };
    }

    const mockReq = (id: string) => ({
      id, title: `Req-${id.slice(0, 8)}`,
      domainKey: 'agent-todo',
      currentStep: 'efficiency_review',
      requesterId: uuid(),
      assigneeId: reqState[id].assigneeId,
      assignee: reqState[id].assignee,
      workflowId: uuid(),
      workflowSnapshot: reqState[id].workflowSnapshot,
      stateVersion: reqState[id].stateVersion,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const txFindUnique = vi.fn((args: any) => {
      if ([reqId1, reqId2, reqId3].includes(args.where.id)) {
        return Promise.resolve(mockReq(args.where.id));
      }
      return Promise.resolve(null);
    });

    const txUpdateMany = vi.fn((args: any) => {
      const id = args.where.id;
      if (id && reqState[id]) {
        reqState[id] = {
          assigneeId: toId,
          assignee: '效率管家',
          stateVersion: updatedStateVersion,
          workflowSnapshot: {
            roleUserMap: { 'efficiency-manager': toId, 'lobster-partner': fromId, executor: fromId },
            steps: [{ name: 'efficiency_review', role: 'efficiency-manager' }],
          },
        };
      }
      return Promise.resolve({ count: writeCount });
    });

    return {
      fromId, toId, actorId, reqId1, reqId2, reqId3,
      prisma: {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{
          current_database: 'agent_dev_center', current_schema: 'public',
          current_user: 'u', inet_server_addr: '127.0.0.1', inet_server_port: 5432,
        }]),
        requirement: {
          findUnique: vi.fn((args: any) => Promise.resolve(
            [reqId1, reqId2, reqId3].includes(args.where.id) ? mockReq(args.where.id) : null
          )),
          count: vi.fn().mockResolvedValue(3),
          updateMany: vi.fn().mockResolvedValue({ count: writeCount }),
        },
        workflowTransition: { count: vi.fn().mockResolvedValue(0) },
        requirementReport: { count: vi.fn().mockResolvedValue(0) },
        user: {
          findUnique: vi.fn((args: any) => {
            if (args.where.id === fromId) return Promise.resolve({ id: fromId, name: 'MAYF3', email: 'm@t.local', enabled: true, roles: ['adc:admin'], internalRole: 'cto', role: 'admin' });
            if (args.where.id === toId) return Promise.resolve({ id: toId, name: '效率管家', email: 'e@t.local', enabled: true, roles: ['adc:admin'], internalRole: 'cto', role: 'admin' });
            if (args.where.id === actorId) return Promise.resolve({ id: actorId, name: 'Op', email: 'o@t.local', enabled: true, roles: ['adc:admin'], internalRole: 'cto', role: 'admin' });
            return Promise.resolve(null);
          }),
        },
        businessDomain: { findUnique: vi.fn().mockResolvedValue({ key: 'agent-todo', isActive: true }) },
        workflowTemplate: { findUnique: vi.fn().mockResolvedValue({ name: 'agent-todo-v1', isActive: true }) },
        auditLog: {
          create: vi.fn().mockImplementation(() => Promise.resolve({ id: auditLogIds[auditIdx++] })),
        },
        $transaction: vi.fn(async (cb: any) => cb({
          requirement: {
            findUnique: txFindUnique,
            count: vi.fn().mockResolvedValue(3),
            updateMany: txUpdateMany,
          },
          auditLog: {
            create: vi.fn().mockImplementation(() => Promise.resolve({ id: auditLogIds[auditIdx++] })),
          },
          workflowTransition: { count: vi.fn().mockResolvedValue(0) },
          requirementReport: { count: vi.fn().mockResolvedValue(0) },
        })),
        $connect: vi.fn(),
        $disconnect: vi.fn(),
      } as any,
    };
  }

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/agent_dev_center?schema=public';
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('14.1 apply performs CAS updates and creates audit logs', async () => {
    const { executeApply } = await import('../scripts/agent-todo-efficiency-cutover/service.js');
    const { fromId, toId, actorId, reqId1, reqId2, reqId3, prisma } = makeApplyMock(1);
    const args = {
      mode: 'apply' as const,
      requirementIds: [reqId1, reqId2, reqId3] as [string, string, string],
      fromUserId: fromId,
      toUserId: toId,
      actorId,
      actorName: 'Op',
      expectedHost: 'localhost',
      expectedDatabase: 'agent_dev_center',
      expectedSchema: 'public',
      expectedAgentTodoCount: 3,
      expectedToUserEmail: 'e@t.local',
      expectedFromUserName: 'MAYF3',
    };

    const summary = await executeApply(prisma, args);
    expect(summary.mode).toBe('apply');
    expect(summary.requirements).toHaveLength(3);
    expect(summary.auditLogIds).toHaveLength(3);
    for (const r of summary.requirements) {
      expect(r.stateVersionAfter).toBe(r.stateVersionBefore + 1);
    }
  });

  it('14.2 CAS conflict causes full rollback', async () => {
    const { executeApply } = await import('../scripts/agent-todo-efficiency-cutover/service.js');
    const { fromId, toId, actorId, reqId1, reqId2, reqId3, prisma } = makeApplyMock(0);
    const args = {
      mode: 'apply' as const,
      requirementIds: [reqId1, reqId2, reqId3] as [string, string, string],
      fromUserId: fromId,
      toUserId: toId,
      actorId,
      actorName: 'Op',
      expectedHost: 'localhost',
      expectedDatabase: 'agent_dev_center',
      expectedSchema: 'public',
      expectedAgentTodoCount: 3,
    };
    await expect(executeApply(prisma, args)).rejects.toThrow('CAS_CONFLICT');
  });

  it('14.3 stateVersion increments after apply', async () => {
    const { executeApply } = await import('../scripts/agent-todo-efficiency-cutover/service.js');
    const { fromId, toId, actorId, reqId1, reqId2, reqId3, prisma } = makeApplyMock(1);
    const args = {
      mode: 'apply' as const,
      requirementIds: [reqId1, reqId2, reqId3] as [string, string, string],
      fromUserId: fromId,
      toUserId: toId,
      actorId,
      actorName: 'Op',
      expectedHost: 'localhost',
      expectedDatabase: 'agent_dev_center',
      expectedSchema: 'public',
      expectedAgentTodoCount: 3,
    };
    const summary = await executeApply(prisma, args);
    for (const r of summary.requirements) {
      expect(r.stateVersionAfter).toBe(r.stateVersionBefore + 1);
    }
  });
});

// ─── 15. Agent Todo Count Validation ──────────────────────────────────────

describe('Agent Todo count function', () => {
  it('15.1 countAgentTodoRequirements returns count', async () => {
    const prisma = { requirement: { count: vi.fn().mockResolvedValue(42) } } as any;
    const count = await countAgentTodoRequirements(prisma);
    expect(count).toBe(42);
    expect(prisma.requirement.count).toHaveBeenCalledWith({ where: { domainKey: 'agent-todo' } });
  });
});

// ─── 16. Rollback AuditLog Matching ──────────────────────────────────────

describe('Rollback audit log details', () => {
  it('16.1 buildRollbackAuditLogDetails includes original operation reference', () => {
    const origOp = uuid();
    const rollbackOp = uuid();
    const details = buildRollbackAuditLogDetails(
      rollbackOp, origOp, rollbackOp,
      { id: 'r1', title: 'T', efficiencyManagerUserId: 'from-uuid', assigneeId: 'from-uuid', assignee: 'MAYF3', stateVersion: 0, roleUserMap: {} },
      1, 2,
    );
    expect(details.originalOperationId).toBe(origOp);
    expect(details.rollbackOperationId).toBe(rollbackOp);
    expect(details.restoredPreimage.stateVersionBefore).toBe(1);
    expect(details.restoredPreimage.stateVersionAfter).toBe(2);
  });
});

// ─── 17. Service Rollback ──────────────────────────────────────────────────

describe('Service rollback', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/agent_dev_center?schema=public';
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('17.1 rollback validates precondition and reads audit logs', async () => {
    const { executeRollback } = await import('../scripts/agent-todo-efficiency-cutover/service.js');
    const actorId = uuid();
    const opId = uuid();
    const reqId1 = uuid();
    const reqId2 = uuid();
    const reqId3 = uuid();
    const toUserId = uuid(); // postimage efficiency-manager

    // Mutable state for in-transaction findUnique after update
    let updated = false;
    const reqState = {
      assigneeId: toUserId,
      assignee: '效率管家',
      stateVersion: 1,
      workflowSnapshot: {
        roleUserMap: { 'efficiency-manager': toUserId, 'lobster-partner': uuid(), executor: uuid() },
      },
    };

    const prisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{
        current_database: 'agent_dev_center', current_schema: 'public',
        current_user: 'u', inet_server_addr: '127.0.0.1', inet_server_port: 5432,
      }]),
      requirement: {
        findUnique: vi.fn().mockResolvedValue({
          id: reqId1, title: 'T', currentStep: 'efficiency_review',
          assigneeId: toUserId, assignee: '效率管家', workflowSnapshot: {
            roleUserMap: { 'efficiency-manager': toUserId, 'lobster-partner': uuid(), executor: uuid() },
          }, stateVersion: 1,
        }),
        count: vi.fn().mockResolvedValue(3),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      workflowTransition: { count: vi.fn().mockResolvedValue(0) },
      requirementReport: { count: vi.fn().mockResolvedValue(0) },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: actorId, name: 'Op', email: 'o@t.local',
          enabled: true, roles: ['adc:admin'], internalRole: 'cto', role: 'admin',
        }),
      },
      businessDomain: { findUnique: vi.fn().mockResolvedValue({ key: 'agent-todo', isActive: true }) },
      workflowTemplate: { findUnique: vi.fn().mockResolvedValue({ name: 'agent-todo-v1', isActive: true }) },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: uuid(), targetId: reqId1,
            details: {
              operationId: opId,
              preimage: { efficiencyManagerUserId: uuid(), assigneeId: uuid(), assignee: 'MAYF3' },
              postimage: { efficiencyManagerUserId: toUserId, assigneeId: toUserId, assignee: '效率管家', stateVersion: 1 },
            },
          },
          {
            id: uuid(), targetId: reqId2,
            details: {
              operationId: opId,
              preimage: { efficiencyManagerUserId: uuid(), assigneeId: uuid(), assignee: 'MAYF3' },
              postimage: { efficiencyManagerUserId: toUserId, assigneeId: toUserId, assignee: '效率管家', stateVersion: 1 },
            },
          },
          {
            id: uuid(), targetId: reqId3,
            details: {
              operationId: opId,
              preimage: { efficiencyManagerUserId: uuid(), assigneeId: uuid(), assignee: 'MAYF3' },
              postimage: { efficiencyManagerUserId: toUserId, assigneeId: toUserId, assignee: '效率管家', stateVersion: 1 },
            },
          },
        ]),
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb({
        requirement: {
          findUnique: vi.fn((args: any) => {
            const rid = args?.where?.id;
            if (rid === reqId1) return Promise.resolve({ id: reqId1, title: 'T1', currentStep: 'efficiency_review', assigneeId: toUserId, assignee: '效率管家', workflowSnapshot: { roleUserMap: { 'efficiency-manager': toUserId, 'lobster-partner': uuid(), executor: uuid() } }, stateVersion: 1 });
            if (rid === reqId2) return Promise.resolve({ id: reqId2, title: 'T2', currentStep: 'efficiency_review', assigneeId: toUserId, assignee: '效率管家', workflowSnapshot: { roleUserMap: { 'efficiency-manager': toUserId, 'lobster-partner': uuid(), executor: uuid() } }, stateVersion: 1 });
            return Promise.resolve({ id: reqId3, title: 'T3', currentStep: 'efficiency_review', assigneeId: toUserId, assignee: '效率管家', workflowSnapshot: { roleUserMap: { 'efficiency-manager': toUserId, 'lobster-partner': uuid(), executor: uuid() } }, stateVersion: 1 });
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({ id: uuid() }) },
      })),
      $connect: vi.fn(),
      $disconnect: vi.fn(),
    } as any;

    const args = {
      mode: 'rollback' as const,
      actorId,
      actorName: 'Op',
      operationId: opId,
      expectedHost: 'localhost',
      expectedDatabase: 'agent_dev_center',
      expectedSchema: 'public',
      expectedAgentTodoCount: 3,
    };

    const summary = await executeRollback(prisma, args);
    expect(summary.mode).toBe('rollback');
    expect(summary.originalOperationId).toBe(opId);
    expect(summary.requirements).toHaveLength(3);
  });
});

// ─── 18. Folder Access Validation ──────────────────────────────────────────

describe('Folder access validation', () => {
  function buildUser(overrides: Record<string, any> = {}): any {
    return {
      id: overrides.id || crypto.randomUUID(),
      name: overrides.name || 'TestUser',
      email: overrides.email || 'test@test.local',
      enabled: overrides.enabled ?? true,
      roles: overrides.roles ?? ['adc:admin'],
      internalRole: overrides.internalRole ?? null,
      role: overrides.role ?? 'developer',
    };
  }

  it('18.1 global admin passes (isPlatformAdmin shortcut)', async () => {
    const { validateUserCanAccessDomain } = await import('../scripts/agent-todo-efficiency-cutover/validators.js');
    const user = buildUser({ roles: ['adc:admin'] });
    const prisma = { businessDomain: { findUnique: vi.fn() }, domainRoleBinding: { findMany: vi.fn() } } as any;
    await expect(validateUserCanAccessDomain(prisma, user, 'agent-todo')).resolves.toBeUndefined();
    expect(prisma.businessDomain.findUnique).not.toHaveBeenCalled();
  });

  it('18.2 user with hit binding role passes', async () => {
    const { validateUserCanAccessDomain } = await import('../scripts/agent-todo-efficiency-cutover/validators.js');
    const user = buildUser({ roles: ['adc:pm'] });
    const prisma = {
      businessDomain: { findUnique: vi.fn().mockResolvedValue({ key: 'agent-todo', isActive: true }) },
      domainRoleBinding: { findMany: vi.fn().mockResolvedValue([{ role: 'adc:pm' }]) },
    } as any;
    await expect(validateUserCanAccessDomain(prisma, user, 'agent-todo')).resolves.toBeUndefined();
  });

  it('18.3 user with no matching role blocks', async () => {
    const { validateUserCanAccessDomain, FOLDER_ACCESS_ERROR } = await import('../scripts/agent-todo-efficiency-cutover/validators.js');
    const user = buildUser({ roles: ['adc:viewer'] });
    const prisma = {
      businessDomain: { findUnique: vi.fn().mockResolvedValue({ key: 'agent-todo', isActive: true }) },
      domainRoleBinding: { findMany: vi.fn().mockResolvedValue([{ role: 'adc:pm' }, { role: 'adc:developer' }]) },
    } as any;
    await expect(validateUserCanAccessDomain(prisma, user, 'agent-todo')).rejects.toThrow(FOLDER_ACCESS_ERROR);
  });

  it('18.4 user has role but no binding in DB blocks', async () => {
    const { validateUserCanAccessDomain, FOLDER_ACCESS_ERROR } = await import('../scripts/agent-todo-efficiency-cutover/validators.js');
    const user = buildUser({ roles: ['adc:pm'] });
    const prisma = {
      businessDomain: { findUnique: vi.fn().mockResolvedValue({ key: 'agent-todo', isActive: true }) },
      domainRoleBinding: { findMany: vi.fn().mockResolvedValue([{ role: 'adc:developer' }]) },
    } as any;
    await expect(validateUserCanAccessDomain(prisma, user, 'agent-todo')).rejects.toThrow(FOLDER_ACCESS_ERROR);
  });

  it('18.5 domain inactive blocks', async () => {
    const { validateUserCanAccessDomain, FOLDER_ACCESS_ERROR } = await import('../scripts/agent-todo-efficiency-cutover/validators.js');
    const user = buildUser({ roles: ['adc:pm'] });
    const prisma = {
      businessDomain: { findUnique: vi.fn().mockResolvedValue({ key: 'agent-todo', isActive: false }) },
      domainRoleBinding: { findMany: vi.fn() },
    } as any;
    await expect(validateUserCanAccessDomain(prisma, user, 'agent-todo')).rejects.toThrow(FOLDER_ACCESS_ERROR);
  });

  it('18.6 dynamic binding role passes', async () => {
    const { validateUserCanAccessDomain } = await import('../scripts/agent-todo-efficiency-cutover/validators.js');
    const user = buildUser({ roles: ['adc:operations-specialist'] });
    const prisma = {
      businessDomain: { findUnique: vi.fn().mockResolvedValue({ key: 'agent-todo', isActive: true }) },
      domainRoleBinding: { findMany: vi.fn().mockResolvedValue([{ role: 'adc:operations-specialist' }]) },
    } as any;
    await expect(validateUserCanAccessDomain(prisma, user, 'agent-todo')).resolves.toBeUndefined();
  });

  it('18.7 global admin passes even with no bindings', async () => {
    const { validateUserCanAccessDomain } = await import('../scripts/agent-todo-efficiency-cutover/validators.js');
    const user = buildUser({ roles: ['adc:admin'] });
    const prisma = { businessDomain: { findUnique: vi.fn() }, domainRoleBinding: { findMany: vi.fn() } } as any;
    await expect(validateUserCanAccessDomain(prisma, user, 'agent-todo')).resolves.toBeUndefined();
  });

  it('18.8 dry-run blocks when toUser has no folder access', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/agent_dev_center?schema=public';
    const { executeDryRun } = await import('../scripts/agent-todo-efficiency-cutover/service.js');
    const fromId = crypto.randomUUID(), toId = crypto.randomUUID(), actorId = crypto.randomUUID();
    const reqId1 = crypto.randomUUID(), reqId2 = crypto.randomUUID(), reqId3 = crypto.randomUUID();
    const mockReq = (id: string) => ({ id, title: `R-${id.slice(0, 8)}`, domainKey: 'agent-todo', currentStep: 'efficiency_review', requesterId: crypto.randomUUID(), assigneeId: fromId, assignee: 'MAYF3', workflowId: crypto.randomUUID(), workflowSnapshot: { roleUserMap: { 'efficiency-manager': fromId, 'lobster-partner': fromId, executor: fromId }, steps: [] }, stateVersion: 0, createdAt: new Date(), updatedAt: new Date() });
    const prisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ current_database: 'agent_dev_center', current_schema: 'public', current_user: 'u', inet_server_addr: '127.0.0.1', inet_server_port: 5432 }]),
      requirement: { findUnique: vi.fn((a: any) => Promise.resolve([reqId1, reqId2, reqId3].includes(a.where.id) ? mockReq(a.where.id) : null)), count: vi.fn().mockResolvedValue(3), updateMany: vi.fn() },
      workflowTransition: { count: vi.fn().mockResolvedValue(0) }, requirementReport: { count: vi.fn().mockResolvedValue(0) },
      user: { findUnique: vi.fn((a: any) => {
        if (a.where.id === fromId) return Promise.resolve({ id: fromId, name: 'MAYF3', email: 'm@t.local', enabled: true, roles: ['adc:admin'], internalRole: 'cto', role: 'admin' });
        if (a.where.id === toId) return Promise.resolve({ id: toId, name: '效率管家', email: 'e@t.local', enabled: true, roles: ['adc:viewer'], internalRole: null, role: 'developer' });
        if (a.where.id === actorId) return Promise.resolve({ id: actorId, name: 'Op', email: 'o@t.local', enabled: true, roles: ['adc:admin'], internalRole: 'cto', role: 'admin' });
        return Promise.resolve(null);
      })},
      businessDomain: { findUnique: vi.fn().mockResolvedValue({ key: 'agent-todo', isActive: true }) },
      workflowTemplate: { findUnique: vi.fn().mockResolvedValue({ name: 'agent-todo-v1', isActive: true }) },
      domainRoleBinding: { findMany: vi.fn().mockResolvedValue([{ role: 'adc:pm' }]) },
      auditLog: { findMany: vi.fn(), create: vi.fn() }, $transaction: vi.fn(), $connect: vi.fn(), $disconnect: vi.fn(),
    } as any;
    const args = { mode: 'dry-run' as const, requirementIds: [reqId1, reqId2, reqId3] as [string, string, string], fromUserId: fromId, toUserId: toId, actorId, actorName: 'Op', expectedHost: 'localhost', expectedDatabase: 'agent_dev_center', expectedSchema: 'public', expectedAgentTodoCount: 3, expectedToUserEmail: 'e@t.local', expectedFromUserName: 'MAYF3' };
    await expect(executeDryRun(prisma, args)).rejects.toThrow('BLOCKED_BY_TO_USER_FOLDER_ACCESS');
    expect(prisma.requirement.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    delete process.env.DATABASE_URL;
  });

  it('18.9 apply blocks when toUser has no folder access (zero writes)', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/agent_dev_center?schema=public';
    const { executeApply } = await import('../scripts/agent-todo-efficiency-cutover/service.js');
    const fromId = crypto.randomUUID(), toId = crypto.randomUUID(), actorId = crypto.randomUUID();
    const reqId1 = crypto.randomUUID(), reqId2 = crypto.randomUUID(), reqId3 = crypto.randomUUID();
    const mockReq = (id: string) => ({ id, title: `R-${id.slice(0, 8)}`, domainKey: 'agent-todo', currentStep: 'efficiency_review', requesterId: crypto.randomUUID(), assigneeId: fromId, assignee: 'MAYF3', workflowId: crypto.randomUUID(), workflowSnapshot: { roleUserMap: { 'efficiency-manager': fromId, 'lobster-partner': fromId, executor: fromId }, steps: [] }, stateVersion: 0, createdAt: new Date(), updatedAt: new Date() });
    const prisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ current_database: 'agent_dev_center', current_schema: 'public', current_user: 'u', inet_server_addr: '127.0.0.1', inet_server_port: 5432 }]),
      requirement: { findUnique: vi.fn((a: any) => Promise.resolve([reqId1, reqId2, reqId3].includes(a.where.id) ? mockReq(a.where.id) : null)), count: vi.fn().mockResolvedValue(3), updateMany: vi.fn() },
      workflowTransition: { count: vi.fn().mockResolvedValue(0) }, requirementReport: { count: vi.fn().mockResolvedValue(0) },
      user: { findUnique: vi.fn((a: any) => {
        if (a.where.id === fromId) return Promise.resolve({ id: fromId, name: 'MAYF3', email: 'm@t.local', enabled: true, roles: ['adc:admin'], internalRole: 'cto', role: 'admin' });
        if (a.where.id === toId) return Promise.resolve({ id: toId, name: '效率管家', email: 'e@t.local', enabled: true, roles: ['adc:viewer'], internalRole: null, role: 'developer' });
        if (a.where.id === actorId) return Promise.resolve({ id: actorId, name: 'Op', email: 'o@t.local', enabled: true, roles: ['adc:admin'], internalRole: 'cto', role: 'admin' });
        return Promise.resolve(null);
      })},
      businessDomain: { findUnique: vi.fn().mockResolvedValue({ key: 'agent-todo', isActive: true }) },
      workflowTemplate: { findUnique: vi.fn().mockResolvedValue({ name: 'agent-todo-v1', isActive: true }) },
      domainRoleBinding: { findMany: vi.fn().mockResolvedValue([{ role: 'adc:pm' }]) },
      auditLog: { findMany: vi.fn(), create: vi.fn() }, $transaction: vi.fn(), $connect: vi.fn(), $disconnect: vi.fn(),
    } as any;
    const args = { mode: 'apply' as const, requirementIds: [reqId1, reqId2, reqId3] as [string, string, string], fromUserId: fromId, toUserId: toId, actorId, actorName: 'Op', expectedHost: 'localhost', expectedDatabase: 'agent_dev_center', expectedSchema: 'public', expectedAgentTodoCount: 3, expectedToUserEmail: 'e@t.local', expectedFromUserName: 'MAYF3' };
    await expect(executeApply(prisma, args)).rejects.toThrow('BLOCKED_BY_TO_USER_FOLDER_ACCESS');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.requirement.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    delete process.env.DATABASE_URL;
  });
});
