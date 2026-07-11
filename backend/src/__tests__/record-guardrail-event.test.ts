/**
 * Tests for record-guardrail-event helper (async version)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const UUID = '00000000-0000-0000-0000-000000000001';

const { mockLedgerCreate } = vi.hoisted(() => ({
  mockLedgerCreate: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    requirement: { findUnique: vi.fn(), update: vi.fn() },
    requirementEventLedger: { create: mockLedgerCreate },
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}));

import { recordGuardrailBlocked } from '../lib/record-guardrail-event.js';

describe('recordGuardrailBlocked', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls ledger create with GUARDRAIL_BLOCKED for valid UUID', async () => {
    mockLedgerCreate.mockResolvedValueOnce({ id: 'evt-1' });
    await recordGuardrailBlocked({
      requirementId: UUID, actorId: 'user-1', actorName: 'Tester',
      reasonCode: 'WIP_OVERLOAD', reasonText: 'WIP limit exceeded',
      fromStep: 'dev_self_check', source: 'test',
    });
    expect(mockLedgerCreate).toHaveBeenCalledTimes(1);
    const d = mockLedgerCreate.mock.calls[0][0].data;
    expect(d.eventType).toBe('GUARDRAIL_BLOCKED');
    expect(d.reasonCode).toBe('WIP_OVERLOAD');
    expect(d.fromStep).toBe('dev_self_check');
    expect(d.actorId).toBe('user-1');
    expect(d.actorType).toBe('human');
  });

  it('skips for invalid requirementId', async () => {
    await recordGuardrailBlocked({ requirementId: 'not-a-uuid', reasonCode: 'RM', reasonText: 't', source: 't' });
    expect(mockLedgerCreate).not.toHaveBeenCalled();
  });

  it('skips for null requirementId', async () => {
    await recordGuardrailBlocked({ requirementId: null, reasonCode: 'RM', reasonText: 't', source: 't' });
    expect(mockLedgerCreate).not.toHaveBeenCalled();
  });

  it('sets actorType=system without actorId', async () => {
    mockLedgerCreate.mockResolvedValueOnce({ id: 'evt-1' });
    await recordGuardrailBlocked({ requirementId: UUID, reasonCode: 'SC', reasonText: 'c', source: 't' });
    expect(mockLedgerCreate.mock.calls[0][0].data.actorType).toBe('system');
  });

  it('does NOT throw when ledger write fails', async () => {
    mockLedgerCreate.mockRejectedValueOnce(new Error('DB error'));
    let threw = false;
    try {
      await recordGuardrailBlocked({ requirementId: UUID, reasonCode: 'TL', reasonText: 'l', source: 't' });
    } catch { threw = true; }
    expect(threw).toBe(false);
  });

  it('strips secrets from metadata', async () => {
    mockLedgerCreate.mockResolvedValueOnce({ id: 'evt-1' });
    await recordGuardrailBlocked({
      requirementId: UUID, reasonCode: 'RNA', reasonText: 'r', source: 't',
      metadata: { missingReportTypes: ['TEST'], token: 'secret' },
    });
    const m = mockLedgerCreate.mock.calls[0][0].data.metadata;
    expect(m.missingReportTypes).toEqual(['TEST']);
    expect(m.token).toBeUndefined();
  });
});
