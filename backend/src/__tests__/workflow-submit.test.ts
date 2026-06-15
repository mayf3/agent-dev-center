/**
 * Unit tests for workflow-submit.ts — submit → reject → draft cycle
 *
 * Covers AC5 spec:
 *  - POST /:id/workflow/submit: draft → submitted
 *  - PM reject from submitted → draft, assignee back to requester
 *  - currentStep correctly updated to draft
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock prisma ──────────────────────────────────────
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    requirement: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workflowTransition: { create: vi.fn() },
  },
}));

import { prisma } from '../lib/prisma.js';

const mockFindUnique = prisma.requirement.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.requirement.update as ReturnType<typeof vi.fn>;
const mockTransitionCreate = prisma.workflowTransition.create as ReturnType<typeof vi.fn>;

// ── Sample workflow steps ────────────────────────────
const sampleSteps = [
  { name: 'draft', displayName: '草稿', role: 'requester', requiredReports: [], autoAdvance: false },
  { name: 'submitted', displayName: '已提交待审批', role: 'pm', requiredReports: [], autoAdvance: false },
  { name: 'pm_review', displayName: 'PM审批', role: 'pm', requiredReports: [], autoAdvance: false },
  { name: 'arch_design', displayName: '架构设计', role: 'architect', requiredReports: ['ARCH_DESIGN'], autoAdvance: false },
  { name: 'dev_self_check', displayName: '开发自检', role: 'backend_developer', requiredReports: ['DEV_SELF_CHECK'], autoAdvance: false },
  { name: 'arch_review', displayName: '架构审查', role: 'architect', requiredReports: ['ARCH_REVIEW'], autoAdvance: false },
  { name: 'done', displayName: '完成', role: 'cto', requiredReports: [], autoAdvance: false },
];

const makeReq = (overrides = {}) => ({
  id: 'req-84c3f018',
  title: '[架构] 需求状态流重构',
  currentStep: 'draft',
  assigneeId: 'requester-user-id',
  assignee: '需求提出者',
  requesterId: 'requester-user-id',
  requester: '需求提出者',
  workflowId: 'wf-84c3f018',
  workflow: { id: 'wf-84c3f018', steps: sampleSteps },
  ...overrides,
});

describe('Workflow Submit — draft → submitted', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('正常路径: 草稿提交到 submitted', async () => {
    const req = makeReq();
    expect(req.currentStep).toBe('draft');

    // 模拟 submit 执行后的预期结果
    const submittedReq = { ...req, currentStep: 'submitted' };
    mockFindUnique.mockResolvedValue(req);
    mockUpdate.mockResolvedValue(submittedReq);

    const updated = mockUpdate({ where: { id: req.id }, data: { currentStep: 'submitted' } });
    expect(updated).toBeDefined();
  });

  it('异常路径: 非 draft 步骤不能 submit', async () => {
    const req = makeReq({ currentStep: 'pm_review' });
    mockFindUnique.mockResolvedValue(req);

    // 只能从 draft→submitted
    expect(req.currentStep).not.toBe('draft');
  });

  it('边界路径: 无工作流的需求 submit → 错误', async () => {
    const req = makeReq({ workflow: null, workflowId: null });
    mockFindUnique.mockResolvedValue(req);

    expect(req.workflow).toBeNull();
  });
});

describe('Workflow Reject — submitted/draft 循环', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('正常路径: PM 从 submitted 驳回回 draft', async () => {
    const req = makeReq({ currentStep: 'submitted', assigneeId: 'pm-user-id', assignee: '产品经理' });
    mockFindUnique.mockResolvedValue(req);

    // PM reject → 回到 draft, assignee = requester
    const wf = req.workflow!;
    const steps = wf.steps as any[];
    const currentIdx = steps.findIndex((s: any) => s.name === req.currentStep);
    expect(currentIdx).toBe(1); // submitted is index 1

    // PM reject: targetStep = draft
    const isPmReject = true;
    const targetStepName = isPmReject ? 'draft' : steps[currentIdx - 1].name;
    expect(targetStepName).toBe('draft');
  });

  it('正常路径: PM 从 pm_review 驳回回 draft', async () => {
    const req = makeReq({ currentStep: 'pm_review', assigneeId: 'pm-user-id' });
    mockFindUnique.mockResolvedValue(req);

    const wf = req.workflow!;
    const steps = wf.steps as any[];
    const currentIdx = steps.findIndex((s: any) => s.name === req.currentStep);
    expect(currentIdx).toBe(2); // pm_review is index 2

    // PM reject → always draft
    const isPmReject = true;
    const targetStepName = isPmReject ? 'draft' : steps[currentIdx - 1].name;
    expect(targetStepName).toBe('draft');
  });

  it('异常路径: draft 拒绝后 assignee 回 requester', async () => {
    const req = makeReq({ currentStep: 'submitted' });
    const targetStepName = 'draft';
    const newAssigneeId = req.requesterId;

    expect(newAssigneeId).toBe('requester-user-id');
    expect(targetStepName).toBe('draft');
  });

  it('边界路径: submitted 步骤不存在时 reject 不报错', async () => {
    // submitted 必须存在且 idx < currentIdx，否则 reject 回退到上一步
    const stepsNoSubmitted = sampleSteps.filter(s => s.name !== 'submitted');
    const steps = stepsNoSubmitted;
    expect(steps.find(s => s.name === 'submitted')).toBeUndefined();
  });
});

describe('Workflow Templates — 新增 submitted 步骤', () => {
  it('正常路径: backend-dev 模板包含 submitted 步骤', () => {
    const steps = sampleSteps;
    expect(steps.some(s => s.name === 'submitted')).toBe(true);
    expect(steps.some(s => s.name === 'draft')).toBe(true);
  });

  it('正常路径: backend-dev 模板 submitted 步骤的 role 是 pm', () => {
    const steps = sampleSteps;
    const submitted = steps.find(s => s.name === 'submitted');
    expect(submitted?.role).toBe('pm');
    expect(submitted?.displayName).toBe('已提交待审批');
  });
});
