/**
 * ApprovalLedgerTab — unit tests
 *
 * Covers:
 *  - loading state
 *  - events displayed chronologically
 *  - WORKFLOW_ADVANCED / REPORT_APPROVED / REPORT_REJECTED Chinese labels
 *  - GUARDRAIL_BLOCKED with reason
 *  - empty data with runtime info
 *  - 403 / 404 / API error states
 *  - requirement ID switch reload
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalLedgerTab } from './ApprovalLedgerTab';
import { auditApi } from '../../api/audit';

// ── Mock auditApi ──
vi.mock('../../api/audit', () => ({
  auditApi: {
    fetchEvents: vi.fn(),
    fetchAuditSummary: vi.fn(),
  },
}));

const mockEvents = [
  {
    id: 'evt-1',
    requirementId: 'req-1',
    eventType: 'WORKFLOW_ADVANCED',
    actorId: 'user-1',
    actorName: '张三',
    actorType: 'user',
    fromStatus: 'pending',
    toStatus: 'approved',
    fromStep: 'review',
    toStep: 'done',
    fromAssigneeId: null,
    toAssigneeId: null,
    reasonCode: null,
    reasonText: null,
    evidence: null,
    metadata: null,
    relatedReportId: null,
    relatedAuditLogId: null,
    stateVersionBefore: null,
    stateVersionAfter: null,
    correlationId: null,
    source: null,
    createdAt: '2026-07-11T10:00:00Z',
  },
  {
    id: 'evt-2',
    requirementId: 'req-1',
    eventType: 'REPORT_APPROVED',
    actorId: 'user-2',
    actorName: '李四',
    actorType: 'user',
    fromStatus: null,
    toStatus: null,
    fromStep: null,
    toStep: null,
    fromAssigneeId: null,
    toAssigneeId: null,
    reasonCode: null,
    reasonText: null,
    evidence: null,
    metadata: { score: 95, reviewer: '李四' },
    relatedReportId: 'report-1',
    relatedAuditLogId: null,
    stateVersionBefore: 1,
    stateVersionAfter: 2,
    correlationId: null,
    source: 'report-service',
    createdAt: '2026-07-11T11:00:00Z',
  },
  {
    id: 'evt-3',
    requirementId: 'req-1',
    eventType: 'REPORT_REJECTED',
    actorId: 'user-3',
    actorName: '王五',
    actorType: 'user',
    fromStatus: null,
    toStatus: null,
    fromStep: null,
    toStep: null,
    fromAssigneeId: null,
    toAssigneeId: null,
    reasonCode: 'QUALITY_GAP',
    reasonText: '代码质量未达标，缺少单元测试覆盖',
    evidence: null,
    metadata: null,
    relatedReportId: 'report-2',
    relatedAuditLogId: null,
    stateVersionBefore: null,
    stateVersionAfter: null,
    correlationId: null,
    source: null,
    createdAt: '2026-07-11T12:00:00Z',
  },
  {
    id: 'evt-4',
    requirementId: 'req-1',
    eventType: 'GUARDRAIL_BLOCKED',
    actorId: null,
    actorName: '系统门禁',
    actorType: 'system',
    fromStatus: null,
    toStatus: null,
    fromStep: 'deploy',
    toStep: null,
    fromAssigneeId: null,
    toAssigneeId: null,
    reasonCode: 'DEPLOY_WINDOW_CLOSED',
    reasonText: '当前不在部署窗口期 (09:00-18:00)',
    evidence: null,
    metadata: { windowStart: '09:00', windowEnd: '18:00' },
    relatedReportId: null,
    relatedAuditLogId: null,
    stateVersionBefore: null,
    stateVersionAfter: null,
    correlationId: null,
    source: 'deploy-guard',
    createdAt: '2026-07-11T13:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

/* ─── Loading state ─── */
it('shows loading spinner initially', () => {
  vi.mocked(auditApi.fetchEvents).mockReturnValue(new Promise(() => {}));
  const { container } = render(<ApprovalLedgerTab requirementId="req-1" />);
  // Ant Design Spin renders .ant-spin-spinning with aria-busy="true"
  expect(container.querySelector('.ant-spin-spinning')).toBeInTheDocument();
});

/* ─── Events displayed chronologically ─── */
it('renders events in timeline with Chinese labels', async () => {
  vi.mocked(auditApi.fetchEvents).mockResolvedValue(mockEvents);

  render(<ApprovalLedgerTab requirementId="req-1" />);

  await waitFor(() => {
    expect(screen.getByText('推进工作流')).toBeInTheDocument();
  });

  expect(screen.getByText('批准报告')).toBeInTheDocument();
  expect(screen.getByText('驳回报告')).toBeInTheDocument();
  expect(screen.getByText('系统门禁拦截')).toBeInTheDocument();

  // Actor names
  expect(screen.getByText('张三')).toBeInTheDocument();
  expect(screen.getByText('李四')).toBeInTheDocument();
  expect(screen.getByText('王五')).toBeInTheDocument();
  expect(screen.getByText('系统门禁')).toBeInTheDocument();

  // Status transitions
  expect(screen.getByText('approved')).toBeInTheDocument();
  expect(screen.getByText('pending')).toBeInTheDocument();

  // Reason display
  expect(screen.getByText('代码质量未达标，缺少单元测试覆盖')).toBeInTheDocument();
  expect(screen.getByText('QUALITY_GAP')).toBeInTheDocument();
  expect(screen.getByText('当前不在部署窗口期 (09:00-18:00)')).toBeInTheDocument();
  expect(screen.getByText('DEPLOY_WINDOW_CLOSED')).toBeInTheDocument();
});

/* ─── Empty state ─── */
it('shows empty state when no events returned', async () => {
  vi.mocked(auditApi.fetchEvents).mockResolvedValue([]);

  render(<ApprovalLedgerTab requirementId="req-1" />);

  await waitFor(() => {
    expect(screen.getByText('暂无审批流水记录。')).toBeInTheDocument();
  });

  expect(screen.getByText(/2026 年 7 月 11 日 21:10/)).toBeInTheDocument();
});

/* ─── 403 Forbidden ─── */
it('shows forbidden message on 403', async () => {
  vi.mocked(auditApi.fetchEvents).mockRejectedValue({
    response: { status: 403, data: { message: '无权查看' } },
  });

  render(<ApprovalLedgerTab requirementId="req-1" />);

  await waitFor(() => {
    expect(screen.getByText('你没有权限查看该需求的审批流水账。')).toBeInTheDocument();
  });
});

/* ─── 404 Not Found ─── */
it('shows not-found message on 404', async () => {
  vi.mocked(auditApi.fetchEvents).mockRejectedValue({
    response: { status: 404, data: { message: '需求不存在' } },
  });

  render(<ApprovalLedgerTab requirementId="req-1" />);

  await waitFor(() => {
    expect(screen.getByText('需求不存在。')).toBeInTheDocument();
  });
});

/* ─── API error ─── */
it('shows error message on 5xx', async () => {
  vi.mocked(auditApi.fetchEvents).mockRejectedValue({
    response: { status: 500, data: { message: '服务内部错误' } },
  });

  render(<ApprovalLedgerTab requirementId="req-1" />);

  await waitFor(() => {
    expect(screen.getByText('服务内部错误')).toBeInTheDocument();
  });
});

it('shows generic error message on network failure', async () => {
  vi.mocked(auditApi.fetchEvents).mockRejectedValue(new Error('Network Error'));

  render(<ApprovalLedgerTab requirementId="req-1" />);

  await waitFor(() => {
    expect(screen.getByText('加载异常，请稍后重试。')).toBeInTheDocument();
  });
});

/* ─── Collapsible "查看详情" ─── */
it('shows "查看详情" button when event has metadata', async () => {
  vi.mocked(auditApi.fetchEvents).mockResolvedValue(mockEvents);

  render(<ApprovalLedgerTab requirementId="req-1" />);

  await waitFor(() => {
    // The event with metadata (REPORT_APPROVED) and GUARDRAIL_BLOCKED should have buttons
    const buttons = screen.getAllByText('查看详情');
    expect(buttons.length).toBeGreaterThanOrEqual(2); // at least 2 events have metadata
  });
});

/* ─── Requirement ID change reloads data ─── */
it('re-fetches when requirementId changes', async () => {
  const fetchSpy = vi.mocked(auditApi.fetchEvents);
  fetchSpy.mockResolvedValue([]);

  const { rerender } = render(<ApprovalLedgerTab requirementId="req-1" />);
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('req-1'));

  fetchSpy.mockResolvedValue(mockEvents);
  rerender(<ApprovalLedgerTab requirementId="req-2" />);

  await waitFor(() => {
    expect(fetchSpy).toHaveBeenCalledWith('req-2');
  });
});
