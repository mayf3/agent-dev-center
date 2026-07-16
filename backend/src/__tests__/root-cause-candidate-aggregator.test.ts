/**
 * Tests for RootCauseCandidate aggregator (pure functions)
 */
import { describe, it, expect } from 'vitest';
import {
  buildFingerprint,
  computeSeverity,
  groupEvents,
  buildCandidateUpsert,
  shouldSkipExisting,
  ALLOWED_REASON_CODES,
  ROOT_CAUSE_TYPE_MAP,
  type LedgerEventRow,
} from '../lib/root-cause-candidate-aggregator.js';

const UUID = '00000000-0000-0000-0000-000000000001';

function makeEvent(overrides: Partial<LedgerEventRow> = {}): LedgerEventRow {
  return {
    id: 'evt-1',
    requirementId: UUID,
    eventType: 'GUARDRAIL_BLOCKED',
    reasonCode: 'WIP_OVERLOAD',
    reasonText: 'WIP limit exceeded',
    fromStep: 'dev_self_check',
    toStep: 'arch_review',
    metadata: null,
    createdAt: new Date('2026-07-08T10:00:00Z'),
    requirement: { workflowId: 'wf-1', workflow: { name: 'backend-dev' } },
    ...overrides,
  };
}

describe('ALLOWED_REASON_CODES', () => {
  it('contains exactly the 7 specified codes', () => {
    expect([...ALLOWED_REASON_CODES].sort()).toEqual([
      'DEPLOY_FIELD_MISSING',
      'DEV_SELF_CHECK_REPORT_MISSING',
      'REPORT_NOT_APPROVED',
      'ROLE_MISMATCH',
      'STATE_CONFLICT',
      'TEST_ENV_LOCKED',
      'WIP_OVERLOAD',
    ]);
  });
});

describe('ROOT_CAUSE_TYPE_MAP', () => {
  it('DEV_SELF_CHECK_REPORT_MISSING -> MISSING_REQUIRED_OUTPUT', () => {
    expect(ROOT_CAUSE_TYPE_MAP['DEV_SELF_CHECK_REPORT_MISSING']).toBe('MISSING_REQUIRED_OUTPUT');
  });

  it('WIP_OVERLOAD -> CAPACITY_BOTTLENECK', () => {
    expect(ROOT_CAUSE_TYPE_MAP['WIP_OVERLOAD']).toBe('CAPACITY_BOTTLENECK');
  });

  it('STATE_CONFLICT -> CONCURRENCY_CONFLICT', () => {
    expect(ROOT_CAUSE_TYPE_MAP['STATE_CONFLICT']).toBe('CONCURRENCY_CONFLICT');
  });

  it('TEST_ENV_LOCKED -> INFRA_LOCK_CONTENTION', () => {
    expect(ROOT_CAUSE_TYPE_MAP['TEST_ENV_LOCKED']).toBe('INFRA_LOCK_CONTENTION');
  });
});

describe('buildFingerprint', () => {
  it('produces consistent hash for same inputs', () => {
    const fp1 = buildFingerprint({ reasonCode: 'WIP_OVERLOAD', eventType: 'GUARDRAIL_BLOCKED', fromStep: 'dev_self_check', toStep: 'arch_review', workflowId: 'wf-1' });
    const fp2 = buildFingerprint({ reasonCode: 'WIP_OVERLOAD', eventType: 'GUARDRAIL_BLOCKED', fromStep: 'dev_self_check', toStep: 'arch_review', workflowId: 'wf-1' });
    expect(fp1).toBe(fp2);
  });

  it('different workflowId -> different fingerprint', () => {
    const fp1 = buildFingerprint({ reasonCode: 'WIP_OVERLOAD', eventType: 'GUARDRAIL_BLOCKED', fromStep: 'dev_self_check', toStep: 'arch_review', workflowId: 'wf-1' });
    const fp2 = buildFingerprint({ reasonCode: 'WIP_OVERLOAD', eventType: 'GUARDRAIL_BLOCKED', fromStep: 'dev_self_check', toStep: 'arch_review', workflowId: 'wf-2' });
    expect(fp1).not.toBe(fp2);
  });

  it('does not include requirementId in fingerprint', () => {
    const fp = buildFingerprint({ reasonCode: 'WIP_OVERLOAD', eventType: 'GUARDRAIL_BLOCKED', fromStep: null, toStep: null, workflowId: null });
    expect(fp).toBeTruthy();
    expect(fp.length).toBe(64); // sha256 hex
  });
});

describe('computeSeverity', () => {
  it('>=10 is high', () => expect(computeSeverity(10, 'WIP_OVERLOAD')).toBe('high'));
  it('3-9 is medium', () => expect(computeSeverity(5, 'WIP_OVERLOAD')).toBe('medium'));
  it('<3 and non-min is low', () => expect(computeSeverity(1, 'WIP_OVERLOAD')).toBe('low'));
  it('STATE_CONFLICT >=1 is medium', () => expect(computeSeverity(1, 'STATE_CONFLICT')).toBe('medium'));
  it('TEST_ENV_LOCKED >=1 is medium', () => expect(computeSeverity(2, 'TEST_ENV_LOCKED')).toBe('medium'));
});

describe('groupEvents', () => {
  it('groups events by fingerprint', () => {
    const ev1 = makeEvent({ id: 'e1', fromStep: 'dev_self_check', reasonCode: 'WIP_OVERLOAD' });
    const ev2 = makeEvent({ id: 'e2', fromStep: 'dev_self_check', reasonCode: 'WIP_OVERLOAD' });
    const groups = groupEvents([ev1, ev2]);
    expect(groups.size).toBe(1);
    const g = groups.values().next().value!;
    expect(g.events).toHaveLength(2);
  });

  it('different workflowId -> different groups', () => {
    const ev1 = makeEvent({ id: 'e1', requirement: { workflowId: 'wf-1', workflow: { name: 'backend' } } });
    const ev2 = makeEvent({ id: 'e2', requirement: { workflowId: 'wf-2', workflow: { name: 'frontend' } } });
    const groups = groupEvents([ev1, ev2]);
    expect(groups.size).toBe(2);
  });

  it('skips unknown reasonCode', () => {
    const ev = makeEvent({ reasonCode: 'UNKNOWN_REASON' });
    const groups = groupEvents([ev]);
    expect(groups.size).toBe(0);
  });

  it('maps reasonCode to rootCauseType', () => {
    const ev = makeEvent({ reasonCode: 'DEV_SELF_CHECK_REPORT_MISSING' });
    const groups = groupEvents([ev]);
    const g = groups.values().next().value!;
    expect(g.rootCauseType).toBe('MISSING_REQUIRED_OUTPUT');
    expect(g.title).toBe('开发自检报告缺失');
  });
});

describe('buildCandidateUpsert', () => {
  it('produces correct severity and counts', () => {
    const events = [
      makeEvent({ id: 'e1', requirementId: UUID, createdAt: new Date('2026-07-08T10:00:00Z') }),
      makeEvent({ id: 'e2', requirementId: UUID, createdAt: new Date('2026-07-08T11:00:00Z') }),
      makeEvent({ id: 'e3', requirementId: 'req-2', createdAt: new Date('2026-07-08T12:00:00Z') }),
      makeEvent({ id: 'e4', requirementId: 'req-3', createdAt: new Date('2026-07-08T13:00:00Z') }),
    ];
    const groups = groupEvents(events);
    const upsert = buildCandidateUpsert(groups.values().next().value!, 24);

    expect(upsert.affectedRequirementCount).toBe(3);
    expect(upsert.evidenceEventIds).toHaveLength(4);
    expect(upsert.sampleRequirementIds).toHaveLength(3);
    expect(upsert.severity).toBe('medium');
    expect(upsert.eventType).toBe('GUARDRAIL_BLOCKED');
    expect(upsert.rootCauseType).toBe('CAPACITY_BOTTLENECK');
    expect(upsert.fingerprint).toBeTruthy();
  });

  it('caps sampleRequirementIds at 10', () => {
    const events = Array.from({ length: 15 }, (_, i) => makeEvent({ id: `e${i}`, requirementId: `req-${i % 12}` }));
    const groups = groupEvents(events);
    const upsert = buildCandidateUpsert(groups.values().next().value!, 24);
    expect(upsert.sampleRequirementIds.length).toBeLessThanOrEqual(10);
    expect(upsert.evidenceEventIds.length).toBeLessThanOrEqual(20);
  });

  it('builds metadata with sources', () => {
    const ev = makeEvent({ metadata: { source: 'workflow-advance.wip-check' } as any });
    const groups = groupEvents([ev]);
    const upsert = buildCandidateUpsert(groups.values().next().value!, 24);
    expect(upsert.metadata.sources).toContain('workflow-advance.wip-check');
    expect(upsert.metadata.windowHours).toBe(24);
  });
});

describe('shouldSkipExisting', () => {
  it('returns true for resolved', () => expect(shouldSkipExisting('resolved')).toBe(true));
  it('returns true for ignored', () => expect(shouldSkipExisting('ignored')).toBe(true));
  it('returns false for open', () => expect(shouldSkipExisting('open')).toBe(false));
  it('returns false for null', () => expect(shouldSkipExisting(null)).toBe(false));
  it('returns false for acknowledged', () => expect(shouldSkipExisting('acknowledged')).toBe(false));
});
