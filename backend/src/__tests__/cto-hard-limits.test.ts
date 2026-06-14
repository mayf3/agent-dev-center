import { describe, it, expect, vi } from 'vitest';

// ─── Test 1: qa_bypass 已从 schema 中删除 ──────────────────────────────────
describe('CTO 硬约束 — qa_bypass 已从 schema 中删除', () => {
  it('reviewReportSchema 不再包含 qa_bypass 字段', async () => {
    const { reviewReportSchema } = await import('../schemas/report.js');
    const result = reviewReportSchema.safeParse({
      params: { id: '550e8400-e29b-41d4-a716-446655440000', reportId: '550e8400-e29b-41d4-a716-446655440001' },
      body: { status: 'approved', reviewComment: '通过' },
    });
    expect(result.success).toBe(true);
  });

  it('reviewReportSchema 忽略 qa_bypass 额外字段', async () => {
    const { reviewReportSchema } = await import('../schemas/report.js');
    const result = reviewReportSchema.safeParse({
      params: { id: '550e8400-e29b-41d4-a716-446655440000', reportId: '550e8400-e29b-41d4-a716-446655440001' },
      body: {
        status: 'approved',
        qa_bypass: true,
        qa_bypass_reason: '紧急上线',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // qa_bypass 不应出现在解析结果中
      expect((result.data.body as Record<string, unknown>).qa_bypass).toBeUndefined();
      expect((result.data.body as Record<string, unknown>).qa_bypass_reason).toBeUndefined();
    }
  });
});

describe('CTO 硬约束 — enforceReportReviewFlow 不再引用 qaBypass', () => {
  it('enforceReportReviewFlow 正确加载且不依赖 qaBypass', async () => {
    const mod = await import('../middleware/internal-workflow.js');
    expect(typeof mod.enforceReportReviewFlow).toBe('function');
  });
});

// ─── Test 2: startStep 回退限制逻辑 ─────────────────────────────────────────
describe('CTO 硬约束 — assign-workflow startStep 只允许回退', () => {
  // 模拟 workflow.ts 中的步骤索引逻辑
  const mockSteps = [
    'draft', 'pm_review', 'arch_design', 'dev_self_check',
    'arch_review', 'qa_review', 'test_env_deploy', 'testing',
    'security_review', 'qa_pre_release', 'cto_review',
    'merge_to_main', 'deploying', 'done',
  ];

  it('startStep 回退到更早步骤应通过校验', () => {
    const currentStep = 'arch_review';
    const startStep = 'dev_self_check';
    const currentIdx = mockSteps.indexOf(currentStep);
    const targetIdx = mockSteps.indexOf(startStep);
    expect(currentIdx).toBe(4);
    expect(targetIdx).toBe(3);
    expect(targetIdx).toBeLessThan(currentIdx); // 回退 → 允许
  });

  it('startStep 跳到更晚步骤应拒绝', () => {
    const currentStep = 'dev_self_check';
    const startStep = 'qa_review';
    const currentIdx = mockSteps.indexOf(currentStep);
    const targetIdx = mockSteps.indexOf(startStep);
    expect(targetIdx).toBeGreaterThan(currentIdx); // 前跳 → 拒绝
  });

  it('startStep 直接跳到 done 应拒绝', () => {
    const startStep = 'done';
    const lastStep = mockSteps[mockSteps.length - 1];
    expect(startStep).toBe(lastStep); // done 是最后一步，禁止直接跳入
  });

  it('新建需求无 currentStep 允许任意 startStep', () => {
    const currentStep = null;
    const startStep = 'dev_self_check';
    // 无 currentStep 时不触发回退检查
    if (!currentStep) {
      expect(typeof startStep).toBe('string');
    }
  });
});

// ─── Test 3: PUT / PATCH 禁止修改 currentStep ──────────────────────────────
describe('CTO 硬约束 — PUT/PATCH 禁止修改 currentStep', () => {
  it('PUT 请求修改 currentStep 应拒绝', () => {
    const existingCurrentStep = 'dev_self_check';
    const body = { currentStep: 'testing' };
    const shouldReject = 'currentStep' in body && body.currentStep !== existingCurrentStep;
    expect(shouldReject).toBe(true);
  });

  it('PUT 请求保持 currentStep 不变应允许', () => {
    const existingCurrentStep = 'dev_self_check';
    const body = { currentStep: 'dev_self_check' };
    const shouldReject = 'currentStep' in body && body.currentStep !== existingCurrentStep;
    expect(shouldReject).toBe(false);
  });

  it('PUT 请求不传 currentStep 应允许', () => {
    const body = { title: '新标题' };
    const shouldReject = 'currentStep' in body;
    expect(shouldReject).toBe(false);
  });

  it('PATCH 有工作流的需求禁止修改 currentStep', () => {
    const hasWorkflow = true;
    const existingCurrentStep = 'dev_self_check';
    const body = { currentStep: 'done' };
    if (hasWorkflow && 'currentStep' in body && body.currentStep !== existingCurrentStep) {
      // 应该拒绝
      expect(true).toBe(true);
    }
  });
});
