import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import { App as AntApp, Badge, Button, Card, Descriptions, Modal, Space, Spin, Table, Tag, Timeline, Typography } from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { RequirementReport, ReportType, ReportStatus, Finding } from '../api/types';
import { FINDING_SEVERITY_LABELS, FINDING_CATEGORY_LABELS } from '../api/types';
import {
  reportTypeLabels,
  reportStatusLabels,
  reportStatusColors,
  reportTypeOrder
} from '../constants/options';

interface ReportsTimelineProps {
  requirementId: string;
  isAdmin: boolean;
}

/* ── checklist item shared shape ── */
interface ChecklistItem {
  item: string;
  status: 'pass' | 'fail' | 'warning';
  note?: string;
}

/* ── badge icon per status ── */
function statusIcon(status?: ReportStatus) {
  switch (status) {
    case 'approved':
      return <CheckCircleOutlined style={{ fontSize: 18, color: '#52c41a' }} />;
    case 'rejected':
      return <CloseCircleOutlined style={{ fontSize: 18, color: '#ff4d4f' }} />;
    case 'changes_requested':
      return <ExclamationCircleOutlined style={{ fontSize: 18, color: '#1677ff' }} />;
    case 'pending':
      return <ClockCircleOutlined style={{ fontSize: 18, color: '#faad14' }} />;
    default:
      return <ClockCircleOutlined style={{ fontSize: 18, color: '#d9d9d9' }} />;
  }
}

/* ── report content renderers ── */
function renderChecklistTable(items: ChecklistItem[], title?: string) {
  const columns = [
    { title: '检查项', dataIndex: 'item', key: 'item' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: string) => {
        const color = s === 'pass' ? 'green' : s === 'fail' ? 'red' : 'orange';
        const label = s === 'pass' ? '通过' : s === 'fail' ? '失败' : '警告';
        return <Tag color={color}>{label}</Tag>;
      }
    },
    { title: '备注', dataIndex: 'note', key: 'note', render: (v?: string) => v || '-' }
  ];
  return (
    <div style={{ marginBottom: 16 }}>
      {title && <Typography.Text strong>{title}</Typography.Text>}
      {/* Desktop: Table */}
      <div className="report-checklist-table">
        <Table
          rowKey={(_, i) => String(i)}
          columns={columns}
          dataSource={items}
          pagination={false}
          size="small"
          style={{ marginTop: 8 }}
        />
      </div>
      {/* Mobile: Card list */}
      <div className="report-checklist-cards" style={{ marginTop: 8 }}>
        {items.map((item, i) => {
          const color = item.status === 'pass' ? '#52c41a' : item.status === 'fail' ? '#ff4d4f' : '#fa8c16';
          const label = item.status === 'pass' ? '通过' : item.status === 'fail' ? '失败' : '警告';
          return (
            <div key={i} style={{
              padding: '8px 10px',
              borderBottom: '1px solid #f0f0f0',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}>
              <Tag color={color} style={{ margin: 0, flexShrink: 0, fontSize: 11 }}>{label}</Tag>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Text style={{ fontSize: 13, lineHeight: 1.4 }}>{item.item}</Typography.Text>
                {item.note && (
                  <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                    {item.note}
                  </Typography.Text>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderDevSelfCheck(content: Record<string, unknown>) {
  return (
    <>
      {renderChecklistTable((content.checklist as ChecklistItem[]) || [], '自检清单')}
      <Descriptions bordered size="small" column={2} style={{ marginTop: 12 }}>
        <Descriptions.Item label="修复 Bug 数">{String(content.bugsFixed ?? '-')}</Descriptions.Item>
        <Descriptions.Item label="新增单测">{String(content.unitTestsAdded ?? '-')}</Descriptions.Item>
      </Descriptions>
      {content.summary && (
        <Typography.Paragraph style={{ marginTop: 12 }}>
          <Typography.Text strong>总结：</Typography.Text>
          {String(content.summary)}
        </Typography.Paragraph>
      )}
    </>
  );
}

function renderSecurityReview(content: Record<string, unknown>) {
  const vuln = (content.vulnerabilities || {}) as Record<string, number>;
  return (
    <>
      {renderChecklistTable((content.checklist as ChecklistItem[]) || [], '安全检查清单')}
      <Descriptions bordered size="small" column={4} style={{ marginTop: 12 }}>
        <Descriptions.Item label="严重">{vuln.critical ?? 0}</Descriptions.Item>
        <Descriptions.Item label="高危">{vuln.high ?? 0}</Descriptions.Item>
        <Descriptions.Item label="中危">{vuln.medium ?? 0}</Descriptions.Item>
        <Descriptions.Item label="低危">{vuln.low ?? 0}</Descriptions.Item>
      </Descriptions>
      {content.summary && (
        <Typography.Paragraph style={{ marginTop: 12 }}>
          <Typography.Text strong>总结：</Typography.Text>
          {String(content.summary)}
        </Typography.Paragraph>
      )}
    </>
  );
}

function renderTestReport(content: Record<string, unknown>) {
  const tc = (content.testCases || {}) as Record<string, number>;
  const bugs = (content.bugs || []) as Array<Record<string, unknown>>;
  const cov = (content.coverage || {}) as Record<string, string>;
  return (
    <>
      <Descriptions bordered size="small" column={4} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="总计">{tc.total ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="通过">{tc.passed ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="失败">{tc.failed ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="跳过">{tc.skipped ?? '-'}</Descriptions.Item>
      </Descriptions>
      {bugs.length > 0 && (
        <Table
          rowKey={(_, i) => String(i)}
          style={{ marginBottom: 12 }}
          size="small"
          pagination={false}
          dataSource={bugs}
          columns={[
            { title: 'Bug ID', dataIndex: 'id', key: 'id', width: 100 },
            { title: '严重度', dataIndex: 'severity', key: 'severity', width: 90, render: (s: string) => <Tag color={s === 'high' ? 'red' : s === 'medium' ? 'orange' : 'green'}>{s}</Tag> },
            { title: '描述', dataIndex: 'description', key: 'description' },
            { title: '已修复', dataIndex: 'fixed', key: 'fixed', width: 80, render: (v: boolean) => v ? '✅' : '❌' }
          ]}
        />
      )}
      <Descriptions bordered size="small" column={3}>
        <Descriptions.Item label="行覆盖">{cov.lines ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="分支覆盖">{cov.branches ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="函数覆盖">{cov.functions ?? '-'}</Descriptions.Item>
      </Descriptions>
      {content.summary && (
        <Typography.Paragraph style={{ marginTop: 12 }}>
          <Typography.Text strong>总结：</Typography.Text>
          {String(content.summary)}
        </Typography.Paragraph>
      )}
    </>
  );
}

function renderCtoReview(content: Record<string, unknown>) {
  const fields = [
    { label: '代码审查', key: 'codeReview' },
    { label: '功能检查', key: 'functionalityCheck' },
    { label: '文档完整性', key: 'documentation' },
    { label: '部署风险', key: 'deploymentRisk' }
  ];
  return (
    <>
      <Descriptions bordered size="small" column={1} style={{ marginBottom: 12 }}>
        {fields.map(f => (
          <Descriptions.Item key={f.key} label={f.label}>
            <Tag color={String(content[f.key]).includes('通过') || String(content[f.key]).includes('符合') || String(content[f.key]).includes('完整') || String(content[f.key]).includes('低') ? 'green' : 'orange'}>
              {String(content[f.key] ?? '-')}
            </Tag>
          </Descriptions.Item>
        ))}
      </Descriptions>
      {content.summary && (
        <Typography.Paragraph>
          <Typography.Text strong>总结：</Typography.Text>
          {String(content.summary)}
        </Typography.Paragraph>
      )}
    </>
  );
}

function renderDeployConfirm(content: Record<string, unknown>) {
  return (
    <>
      {renderChecklistTable((content.deploymentChecklist as ChecklistItem[]) || [], '部署检查清单')}
      {content.rollbackPlan && (
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          <Typography.Text strong>回滚方案：</Typography.Text>
          {String(content.rollbackPlan)}
        </Typography.Paragraph>
      )}
      {content.deployedAt && (
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="部署时间">{dayjs(String(content.deployedAt)).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
        </Descriptions>
      )}
      {content.summary && (
        <Typography.Paragraph style={{ marginTop: 12 }}>
          <Typography.Text strong>总结：</Typography.Text>
          {String(content.summary)}
        </Typography.Paragraph>
      )}
    </>
  );
}

/* ── QA findings renderer ── */
function renderFindings(findings: Finding[]) {
  if (!findings || findings.length === 0) return null;

  const sorted = [...findings].sort((a, b) => {
    const order = { critical: 0, minor: 1 };
    return (order[a.severity] ?? 99) - (order[b.severity] ?? 99);
  });

  const columns = [
    {
      title: '严重程度',
      dataIndex: 'severity',
      key: 'severity',
      width: 90,
      render: (s: Finding['severity']) => (
        <Tag color={s === 'critical' ? 'red' : 'blue'}>{FINDING_SEVERITY_LABELS[s]}</Tag>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 140,
      render: (c: Finding['category']) => FINDING_CATEGORY_LABELS[c] ?? c,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
    },
  ];

  return (
    <div style={{ marginTop: 16, marginBottom: 16 }}>
      <Typography.Text strong style={{ fontSize: 15 }}>
        🔍 QA 审查发现 ({findings.length} 项)
      </Typography.Text>
      <Table<Finding>
        rowKey={(_, i) => String(i)}
        columns={columns}
        dataSource={sorted}
        pagination={false}
        size="small"
        style={{ marginTop: 8 }}
      />
    </div>
  );
}

function renderPostmortem(content: Record<string, unknown>) {
  const rootCauseAnalysis = (content.rootCauseAnalysis || []) as Array<{ why: string; depth: number; finding: string }>;
  const principles = (content.principles || []) as Array<{ title: string; content: string }>;
  const fixes = (content.fixes || []) as Array<{ action: string; type: string; status: string }>;
  return (
    <>
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="事故标题">{String(content.incidentTitle ?? '-')}</Descriptions.Item>
        <Descriptions.Item label="严重等级">
          <Tag color={
            String(content.severity ?? '') === 'critical' ? 'red' :
            String(content.severity ?? '') === 'high' ? 'volcano' :
            String(content.severity ?? '') === 'medium' ? 'gold' : 'green'
          }>{String(content.severity ?? '-')}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="发生时间" span={2}>{String(content.incidentTime ?? '-')}</Descriptions.Item>
      </Descriptions>

      {content.symptom && (
        <Typography.Paragraph style={{ marginBottom: 12 }}>
          <Typography.Text strong>现象：</Typography.Text>
          {String(content.symptom)}
        </Typography.Paragraph>
      )}

      {rootCauseAnalysis.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text strong>根因分析（5 Whys）</Typography.Text>
          <Table
            rowKey={(_, i) => String(i)}
            size="small"
            pagination={false}
            style={{ marginTop: 8 }}
            dataSource={rootCauseAnalysis}
            columns={[
              { title: '追问', dataIndex: 'why', key: 'why', width: 80, render: (v: string, _r: unknown, i: number) => `Why ${i + 1}` },
              { title: '回答', dataIndex: 'finding', key: 'finding' },
              { title: '层级', dataIndex: 'depth', key: 'depth', width: 80 },
            ]}
          />
        </div>
      )}

      {principles.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text strong>提取的长期原则</Typography.Text>
          {principles.map((p, i) => (
            <Card key={i} size="small" style={{ marginTop: 8, borderLeft: '3px solid #1677ff' }}>
              <Typography.Text strong>{p.title}</Typography.Text>
              <Typography.Paragraph style={{ marginTop: 4 }}>{p.content}</Typography.Paragraph>
            </Card>
          ))}
        </div>
      )}

      {fixes.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text strong>预防措施</Typography.Text>
          <Table
            rowKey="action"
            size="small"
            pagination={false}
            style={{ marginTop: 8 }}
            dataSource={fixes}
            columns={[
              { title: '措施', dataIndex: 'action', key: 'action' },
              { title: '类型', dataIndex: 'type', key: 'type', width: 100, render: (v: string) => <Tag>{v}</Tag> },
              { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (v: string) => (
                <Tag color={v === 'done' ? 'green' : v === 'in-progress' ? 'blue' : 'orange'}>{v}</Tag>
              )},
            ]}
          />
        </div>
      )}

      {content.summary && (
        <Typography.Paragraph style={{ marginTop: 12 }}>
          <Typography.Text strong>总结：</Typography.Text>
          {String(content.summary)}
        </Typography.Paragraph>
      )}
    </>
  );
}

function renderReportContent(report: RequirementReport) {
  const { reportType, content } = report;
  switch (reportType) {
    case 'POSTMORTEM': return renderPostmortem(content);
    case 'DEV_SELF_CHECK': return renderDevSelfCheck(content);
    case 'SECURITY_REVIEW': return renderSecurityReview(content);
    case 'TEST_REPORT': return renderTestReport(content);
    case 'CTO_REVIEW': return renderCtoReview(content);
    case 'DEPLOY_CONFIRM': return renderDeployConfirm(content);
    default: return <pre style={{ fontSize: 12 }}>{JSON.stringify(content, null, 2)}</pre>;
  }
}

export function ReportsTimeline({ requirementId, isAdmin }: ReportsTimelineProps) {
  const { message } = AntApp.useApp();
  const [reports, setReports] = useState<RequirementReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailReport, setDetailReport] = useState<RequirementReport | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ success: boolean; data: RequirementReport[] }>(
        `/requirements/${requirementId}/reports`
      );
      // Support both { data: [...] } and direct array responses
      setReports(Array.isArray(data) ? data : data.data ?? []);
    } catch (err) {
      message.error('验收报告加载失败');
    } finally {
      setLoading(false);
    }
  }, [requirementId, message]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  // Build a map from reportType to the latest report of that type
  const reportMap = new Map<ReportType, RequirementReport>();
  for (const r of reports) {
    const existing = reportMap.get(r.reportType);
    if (!existing || dayjs(r.createdAt).isAfter(dayjs(existing.createdAt))) {
      reportMap.set(r.reportType, r);
    }
  }

  if (loading) {
    return <Spin />;
  }

  const timelineItems = reportTypeOrder.map((type) => {
    const report = reportMap.get(type);
    const label = reportTypeLabels[type];
    const dot = statusIcon(report?.status);

    if (!report) {
      return {
        dot,
        children: (
          <Card size="small" style={{ opacity: 0.5 }}>
            <Typography.Text type="secondary">
              {label} — 等待提交
            </Typography.Text>
          </Card>
        )
      };
    }

    return {
      dot,
      children: (
        <Card
          size="small"
          style={{ marginBottom: 4 }}
          extra={
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => setDetailReport(report)}
            >
              查看详情
            </Button>
          }
        >
          <Space direction="vertical" size={4}>
            <Space size={8}>
              <Typography.Text strong>{label}</Typography.Text>
              <Badge
                status={
                  report.status === 'approved' ? 'success' :
                  report.status === 'rejected' ? 'error' :
                  report.status === 'changes_requested' ? 'processing' :
                  'warning'
                }
                text={reportStatusLabels[report.status]}
              />
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              提交者：{report.submittedBy} · {dayjs(report.createdAt).format('YYYY-MM-DD HH:mm')}
            </Typography.Text>
            {report.reviewComment && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                审核意见：{report.reviewComment}
              </Typography.Text>
            )}
          </Space>
        </Card>
      )
    };
  });

  return (
    <>
      <Card
        title={
          <Space>
            <FileTextOutlined />
            验收报告
          </Space>
        }
      >
        {reports.length === 0 ? (
          <Typography.Text type="secondary">暂无验收报告</Typography.Text>
        ) : null}
        <Timeline items={timelineItems} />
      </Card>

      <Modal
        title={detailReport ? reportTypeLabels[detailReport.reportType] + ' 详情' : '报告详情'}
        open={Boolean(detailReport)}
        onCancel={() => setDetailReport(null)}
        footer={null}
        width={720}
      >
        {detailReport && (
          <div>
            {/* Header info */}
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="报告类型">{reportTypeLabels[detailReport.reportType]}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Badge
                  color={reportStatusColors[detailReport.status]}
                  text={reportStatusLabels[detailReport.status]}
                />
              </Descriptions.Item>
              <Descriptions.Item label="提交者">{detailReport.submittedBy}</Descriptions.Item>
              <Descriptions.Item label="提交时间">{dayjs(detailReport.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
              {detailReport.reviewComment && (
                <Descriptions.Item label="审核意见" span={2}>{detailReport.reviewComment}</Descriptions.Item>
              )}
              {detailReport.reviewedAt && (
                <Descriptions.Item label="审核时间" span={2}>
                  {dayjs(detailReport.reviewedAt).format('YYYY-MM-DD HH:mm')}
                </Descriptions.Item>
              )}
            </Descriptions>

            {/* Report content */}
            <Typography.Title level={5}>报告内容</Typography.Title>
            {renderReportContent(detailReport)}

            {/* QA findings (if present) */}
            {renderFindings((detailReport.content.findings as Finding[]) ?? [])}
          </div>
        )}
      </Modal>
    </>
  );
}
