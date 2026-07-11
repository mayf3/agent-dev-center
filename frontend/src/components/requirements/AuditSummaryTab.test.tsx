/**
 * AuditSummaryTab — unit tests
 *
 * Covers:
 *  - loading state
 *  - summary stats display
 *  - cycle summary display (suspectedLoop, loopReasons)
 *  - empty data state
 *  - 403 / 404 / API error states
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditSummaryTab } from './AuditSummaryTab';
import { auditApi } from '../../api/audit';

vi.mock('../../api/audit', () => ({
  auditApi: {
    fetchEvents: vi.fn(),
    fetchAuditSummary: vi.fn(),
  },
}));

const mockSummary = {
  requirement: {
    id: 'req-1',
    title: 'Test Requirement',
    status: 'in-progress',
    currentStep: 'testing',
    assigneeId: 'user-1',
    assigneeName: '张三',
    requesterId: 'user-2',
    requesterName: '李四',
  },
  cycleSummary: {
    totalRejects: 4,
    workflowRejects: 2,
    reportRejects: 2,
    guardrailBlocks: 3,
    sameStepMaxRejectCount: 2,
    sameReasonCodeMaxCount: 3,
    suspectedLoop: true,
    loopReasons: ['QUALITY_GAP', 'MISSING_TEST'],
  },
  timeline: [
    {
      id: 't-1',
      at: '2026-07-11T10:00:00Z',
      eventType: 'WORKFLOW_ADVANCED',
      fromStep: 'review',
      toStep: 'done',
      actorId: 'user-1',
      actorName: '张三',
      actorType: 'user',
      reasonCode: null,
      reasonText: null,
      relatedReportId: null,
      relatedAuditLogId: null,
      summary: '推进流程',
      metadata: null,
    },
    {
      id: 't-2',
      at: '2026-07-11T11:00:00Z',
      eventType: 'WORKFLOW_REJECTED',
      fromStep: 'review',
      toStep: null,
      actorId: 'user-3',
      actorName: '王五',
      actorType: 'user',
      reasonCode: 'QUALITY_GAP',
      reasonText: '质量不达标',
      relatedReportId: null,
      relatedAuditLogId: null,
      summary: '流程被打回',
      metadata: null,
    },
    {
      id: 't-3',
      at: '2026-07-11T12:00:00Z',
      eventType: 'GUARDRAIL_BLOCKED',
      fromStep: 'deploy',
      toStep: null,
      actorId: null,
      actorName: '系统门禁',
      actorType: 'system',
      reasonCode: 'DEPLOY_WINDOW_CLOSED',
      reasonText: '部署窗口已关闭',
      relatedReportId: null,
      relatedAuditLogId: null,
      summary: '推进被阻止',
      metadata: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

/* ─── Loading state ─── */
it('shows loading spinner initially', () => {
  vi.mocked(auditApi.fetchAuditSummary).mockReturnValue(new Promise(() => {}));
  const { container } = render(<AuditSummaryTab requirementId="req-1" />);
  // Ant Design Spin renders .ant-spin-spinning with aria-busy="true"
  expect(container.querySelector('.ant-spin-spinning')).toBeInTheDocument();
});

/* ─── Summary stats display ─── */
it('renders statistics and timeline', async () => {
  vi.mocked(auditApi.fetchAuditSummary).mockResolvedValue(mockSummary);

  render(<AuditSummaryTab requirementId="req-1" />);

  await waitFor(() => {
    // Stats - 推进次数 (WORKFLOW_ADVANCED in timeline = 1)
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  // There are multiple "2" values (workflowRejects=2, reportRejects=2, sameStepMaxRejectCount=2)
  expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(2);

  // Guardrail blocks = 3
  expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);

  // Suspected loop tag
  expect(screen.getByText('疑似存在审批循环')).toBeInTheDocument();

  // Loop reasons — quality_gap appears both as loop reason and timeline reasonCode
  expect(screen.getAllByText('QUALITY_GAP').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('MISSING_TEST')).toBeInTheDocument();

  // Timeline items
  expect(screen.getByText('推进工作流')).toBeInTheDocument();
  expect(screen.getByText('驳回工作流')).toBeInTheDocument();
  expect(screen.getByText('系统门禁拦截')).toBeInTheDocument();
});

/* ─── No loop detected ─── */
it('shows "未检测到审批循环" when no suspected loop', async () => {
  const noLoopSummary = {
    ...mockSummary,
    cycleSummary: { ...mockSummary.cycleSummary, suspectedLoop: false, loopReasons: [] },
  };
  vi.mocked(auditApi.fetchAuditSummary).mockResolvedValue(noLoopSummary);

  render(<AuditSummaryTab requirementId="req-1" />);

  await waitFor(() => {
    expect(screen.getByText('未检测到审批循环')).toBeInTheDocument();
  });
});

/* ─── Empty state ─── */
it('shows empty state when no data', async () => {
  vi.mocked(auditApi.fetchAuditSummary).mockResolvedValue({
    requirement: {
      id: 'req-1', title: '', status: '', currentStep: null,
      assigneeId: null, assigneeName: null, requesterId: null, requesterName: null,
    },
    cycleSummary: {
      totalRejects: 0, workflowRejects: 0, reportRejects: 0, guardrailBlocks: 0,
      sameStepMaxRejectCount: 0, sameReasonCodeMaxCount: 0, suspectedLoop: false, loopReasons: [],
    },
    timeline: [],
  });

  render(<AuditSummaryTab requirementId="req-1" />);

  await waitFor(() => {
    expect(screen.getByText('暂无审批流水记录。')).toBeInTheDocument();
  });
});

/* ─── 403 Forbidden ─── */
it('shows forbidden message on 403', async () => {
  vi.mocked(auditApi.fetchAuditSummary).mockRejectedValue({
    response: { status: 403, data: { message: '无权查看' } },
  });

  render(<AuditSummaryTab requirementId="req-1" />);

  await waitFor(() => {
    expect(screen.getByText('你没有权限查看该需求的审计摘要。')).toBeInTheDocument();
  });
});

/* ─── 404 Not Found ─── */
it('shows not-found message on 404', async () => {
  vi.mocked(auditApi.fetchAuditSummary).mockRejectedValue({
    response: { status: 404, data: { message: '需求不存在' } },
  });

  render(<AuditSummaryTab requirementId="req-1" />);

  await waitFor(() => {
    expect(screen.getByText('需求不存在。')).toBeInTheDocument();
  });
});

/* ─── 5xx error ─── */
it('shows error message on 5xx', async () => {
  vi.mocked(auditApi.fetchAuditSummary).mockRejectedValue({
    response: { status: 500, data: { message: '服务内部错误' } },
  });

  render(<AuditSummaryTab requirementId="req-1" />);

  await waitFor(() => {
    expect(screen.getByText('服务内部错误')).toBeInTheDocument();
  });
});
