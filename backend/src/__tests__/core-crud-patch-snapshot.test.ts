/**
 * Unit test: core-crud.ts PATCH uses workflowSnapshot (not live template)
 * for auto-resolving assignee on step change.
 *
 * PATCH_STEP_WHITELIST only allows: pm_review -> draft, draft -> draft
 * So the test uses pm_review -> draft as the transition.
 *
 * Scenario:
 *   - Requirement at pm_review, workflowSnapshot has [pm_review(role=pm), draft(role=requester)]
 *   - LIVE template has draft step role='cto' (hot-updated, diverged)
 *   - PATCH { currentStep: 'draft' }
 *   - Assert: resolveAssigneeForStep receives 'requester' (snapshot), NOT 'cto' (live template)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module-level mocks (hoisted) ──

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    requirement: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: { findFirst: vi.fn() },
    workflowTemplate: { findUnique: vi.fn() },
    requirementReport: { findMany: vi.fn() },
    workflowTransition: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    notification: { create: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock('../lib/assignee-resolver.js', () => ({
  validateAssigneeRoleMatch: vi.fn().mockResolvedValue({ ok: true }),
  resolveAssigneeForStep: vi.fn().mockResolvedValue('resolved-user-id'),
  getAssigneeName: vi.fn().mockResolvedValue('Resolved User'),
}));

vi.mock('../routes/requirements/utils.js', () => ({
  canEditRequirement: vi.fn().mockReturnValue(true),
}));

// ── Imports (after mocks) ──

import express from 'express';
import { registerCoreCrudRoutes } from '../routes/requirements/core-crud.js';
import { prisma } from '../lib/prisma.js';
import * as assigneeResolver from '../lib/assignee-resolver.js';

const mockFindUnique = prisma.requirement.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.requirement.update as ReturnType<typeof vi.fn>;
const mockResolveAssignee = assigneeResolver.resolveAssigneeForStep as ReturnType<typeof vi.fn>;

const TEST_UUID = '00000000-0000-4000-8000-000000000001';

const SNAPSHOT_STEPS = [
  { name: 'pm_review', displayName: 'PM审核', role: 'pm', requiredReports: [] as string[], autoAdvance: false, assigneeMode: 'role-based' },
  { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [] as string[], autoAdvance: false, assigneeMode: 'role-based' },
];

const LIVE_TEMPLATE_STEPS = [
  { name: 'pm_review', displayName: 'PM审核', role: 'pm', requiredReports: [] as string[], autoAdvance: false, assigneeMode: 'role-based' },
  { name: 'draft', displayName: '草稿(新版)', role: 'cto', requiredReports: [] as string[], autoAdvance: false, assigneeMode: 'role-based' },
];

const BASE_REQUIREMENT = {
  id: TEST_UUID,
  title: 'Snapshot Test',
  workflowId: 'tmpl-1',
  assigneeId: 'user-requester',
  assignee: 'Requester',
  requester: 'Requester',
  status: 'pending',
  priority: 'medium',
  type: 'feature',
  tags: [],
  department: 'engineering',
  projectId: null,
  dueDate: null,
  attachment: null,
  notes: null,
  rejectReason: null,
  gitHash: null,
  deployVersion: null,
  dependsOnIds: [],
  blockedBy: [],
  requesterId: 'user-requester',
  teamId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('core-crud PATCH — snapshot-first assignee resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses workflowSnapshot role (not live template) to resolve assignee on PATCH step change', async () => {
    mockFindUnique.mockResolvedValue({
      ...BASE_REQUIREMENT,
      currentStep: 'pm_review',
      workflowSnapshot: SNAPSHOT_STEPS,
      workflow: { steps: LIVE_TEMPLATE_STEPS },
    });

    mockUpdate.mockResolvedValue({
      ...BASE_REQUIREMENT,
      currentStep: 'draft',
      assignee: 'Resolved User',
      assigneeId: 'resolved-user-id',
    });

    const router = express.Router();
    registerCoreCrudRoutes(router);
    const patchRoute = router.stack.find(
      (l: any) => l.route?.path === '/:id' && l.route?.methods?.patch,
    );
    expect(patchRoute).toBeDefined();
    const wrappedHandler = (patchRoute as any).route.stack[0].handle;

    const req = {
      params: { id: TEST_UUID },
      body: { currentStep: 'draft' },
      user: { id: 'admin-user', name: 'Admin', role: 'admin', internalRole: 'admin' },
    } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;

    await wrappedHandler(req, res, vi.fn());

    // resolveAssigneeForStep should be called with snapshot's draft role ('requester'), not live template's ('cto')
    expect(mockResolveAssignee).toHaveBeenCalledTimes(1);
    const calledRole = mockResolveAssignee.mock.calls[0][0];
    expect(calledRole).toBe('requester');
    expect(calledRole).not.toBe('cto');
  });

  it('falls back to live template role when workflowSnapshot is absent (legacy data)', async () => {
    mockFindUnique.mockResolvedValue({
      ...BASE_REQUIREMENT,
      currentStep: 'pm_review',
      workflowSnapshot: null,
      workflow: { steps: LIVE_TEMPLATE_STEPS },
    });

    mockUpdate.mockResolvedValue({
      ...BASE_REQUIREMENT,
      currentStep: 'draft',
      assignee: 'Resolved User',
      assigneeId: 'resolved-user-id',
    });

    const router = express.Router();
    registerCoreCrudRoutes(router);
    const patchRoute = router.stack.find(
      (l: any) => l.route?.path === '/:id' && l.route?.methods?.patch,
    );
    const wrappedHandler = (patchRoute as any).route.stack[0].handle;

    const req = {
      params: { id: TEST_UUID },
      body: { currentStep: 'draft' },
      user: { id: 'admin-user', name: 'Admin', role: 'admin', internalRole: 'admin' },
    } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;

    await wrappedHandler(req, res, vi.fn());

    // Legacy fallback should use live template role
    expect(mockResolveAssignee).toHaveBeenCalledTimes(1);
    const calledRole = mockResolveAssignee.mock.calls[0][0];
    expect(calledRole).toBe('cto');
  });
});
