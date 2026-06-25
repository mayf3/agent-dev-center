import { Descriptions, Modal, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { RequirementReport, ReportType, QAReviewFinding } from '../api/types';
import {
  reportStatusColors,
  reportStatusLabels,
  reportTypeLabels,
  findingCategoryLabels,
  findingSeverityColors,
} from '../constants/options';

function formatDateTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
}

interface ChecklistItem {
  item: string;
  status: string;
  note?: string;
}

interface Vulnerability {
  severity: string;
  description: string;
  status?: string;
}

interface TestCase {
  name: string;
  status: string;
  duration?: string;
}

interface DeployCheckItem {
  item: string;
  status: string;
  note?: string;
}

function renderDevSelfCheck(content: Record<string, unknown>) {
  const items = (content.checklist as ChecklistItem[]) ?? [];
  const columns: ColumnsType<ChecklistItem> = [
    { title: 'checklist item', dataIndex: 'item', key: 'item' },
    {
      title: 'status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (val: string) => {
        const color = val === 'pass' ? 'green' : val === 'fail' ? 'red' : 'orange';
        return <Tag color={color}>{val}</Tag>;
      },
    },
    { title: 'note', dataIndex: 'note', key: 'note', ellipsis: true },
  ];
  return (
    <>
      <Typography.Text strong>Self-Check Checklist</Typography.Text>
      <Table<ChecklistItem>
        rowKey="item"
        columns={columns}
        dataSource={items}
        pagination={false}
        size="small"
        style={{ marginTop: 8 }}
      />
    </>
  );
}

function renderSecurityReview(content: Record<string, unknown>) {
  const items = (content.checklist as ChecklistItem[]) ?? [];
  const vulns = (content.vulnerabilities as Vulnerability[]) ?? [];

  const checklistColumns: ColumnsType<ChecklistItem> = [
    { title: 'checklist item', dataIndex: 'item', key: 'item' },
    {
      title: 'status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (val: string) => {
        const color = val === 'pass' ? 'green' : val === 'fail' ? 'red' : 'orange';
        return <Tag color={color}>{val}</Tag>;
      },
    },
    { title: 'note', dataIndex: 'note', key: 'note', ellipsis: true },
  ];

  const vulnColumns: ColumnsType<Vulnerability> = [
    {
      title: 'severity',
      dataIndex: 'severity',
      key: 'severity',
      width: 100,
      render: (val: string) => {
        const color =
          val === 'critical' ? 'red' : val === 'high' ? 'volcano' : val === 'medium' ? 'orange' : 'blue';
        return <Tag color={color}>{val}</Tag>;
      },
    },
    { title: 'description', dataIndex: 'description', key: 'description' },
    {
      title: 'status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (val: string) => val ? <Tag>{val}</Tag> : '-',
    },
  ];

  return (
    <>
      <Typography.Text strong>Security Checklist</Typography.Text>
      <Table<ChecklistItem>
        rowKey="item"
        columns={checklistColumns}
        dataSource={items}
        pagination={false}
        size="small"
        style={{ marginTop: 8 }}
      />
      {vulns.length > 0 && (
        <>
          <Typography.Text strong style={{ display: 'block', marginTop: 16 }}>
            Vulnerabilities ({vulns.length})
          </Typography.Text>
          <Table<Vulnerability>
            rowKey="description"
            columns={vulnColumns}
            dataSource={vulns}
            pagination={false}
            size="small"
            style={{ marginTop: 8 }}
          />
        </>
      )}
    </>
  );
}

function renderTestReport(content: Record<string, unknown>) {
  const testCases = (content.testCases as TestCase[]) ?? [];
  const stats = content.stats as Record<string, unknown> | undefined;

  const columns: ColumnsType<TestCase> = [
    { title: 'test case', dataIndex: 'name', key: 'name' },
    {
      title: 'status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (val: string) => {
        const color = val === 'passed' ? 'green' : val === 'failed' ? 'red' : 'orange';
        return <Tag color={color}>{val}</Tag>;
      },
    },
    {
      title: 'duration',
      dataIndex: 'duration',
      key: 'duration',
      width: 100,
      render: (val: string) => val ?? '-',
    },
  ];

  return (
    <>
      {stats && (
        <Descriptions bordered size="small" column={3} style={{ marginBottom: 12 }}>
          {Object.entries(stats).map(([key, val]) => (
            <Descriptions.Item key={key} label={key}>
              {String(val)}
            </Descriptions.Item>
          ))}
        </Descriptions>
      )}
      <Typography.Text strong>Test Cases</Typography.Text>
      <Table<TestCase>
        rowKey="name"
        columns={columns}
        dataSource={testCases}
        pagination={false}
        size="small"
        style={{ marginTop: 8 }}
      />
    </>
  );
}

function renderCtoReview(content: Record<string, unknown>) {
  const fields = ['codeReview', 'functionality', 'documentation', 'risk'] as const;
  return (
    <Descriptions bordered size="small" column={1}>
      {fields.map((field) => (
        <Descriptions.Item key={field} label={field}>
          {content[field] != null ? String(content[field]) : '-'}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

function renderDeployConfirm(content: Record<string, unknown>) {
  const items = (content.checklist as DeployCheckItem[]) ?? [];
  const columns: ColumnsType<DeployCheckItem> = [
    { title: 'checklist item', dataIndex: 'item', key: 'item' },
    {
      title: 'status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (val: string) => {
        const color = val === 'pass' ? 'green' : val === 'fail' ? 'red' : 'orange';
        return <Tag color={color}>{val}</Tag>;
      },
    },
    { title: 'note', dataIndex: 'note', key: 'note', ellipsis: true },
  ];

  return (
    <>
      <Typography.Text strong>Deployment Checklist</Typography.Text>
      <Table<DeployCheckItem>
        rowKey="item"
        columns={columns}
        dataSource={items}
        pagination={false}
        size="small"
        style={{ marginTop: 8 }}
      />
    </>
  );
}

function renderPostmortem(content: Record<string, unknown>) {
  const rca = (content.rootCauseAnalysis as Array<{why: string; depth: number; finding: string}>) ?? [];
  const principles = (content.principles as Array<{title: string; content: string}>) ?? [];
  const fixes = (content.fixes as Array<{action: string; type: string; status: string}>) ?? [];

  return (
    <>
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Incident">{String(content.incidentTitle ?? '-')}</Descriptions.Item>
        <Descriptions.Item label="Severity">{String(content.severity ?? '-')}</Descriptions.Item>
        <Descriptions.Item label="Time">{String(content.incidentTime ?? '-')}</Descriptions.Item>
      </Descriptions>

      {content.symptom && (
        <Typography.Paragraph style={{ marginBottom: 12 }}>
          <Typography.Text strong>Symptom: </Typography.Text>
          {String(content.symptom)}
        </Typography.Paragraph>
      )}

      {rca.length > 0 && (
        <>
          <Typography.Text strong>Root Cause Analysis (5 Whys)</Typography.Text>
          <Table
            rowKey={(_, i) => String(i)}
            size="small"
            pagination={false}
            style={{ marginTop: 8, marginBottom: 12 }}
            dataSource={rca}
            columns={[
              { title: 'Why', dataIndex: 'why', key: 'why', width: 80, render: (_v: string, _r: unknown, i: number) => `Why ${i + 1}` },
              { title: 'Finding', dataIndex: 'finding', key: 'finding' },
              { title: 'Depth', dataIndex: 'depth', key: 'depth', width: 80 },
            ]}
          />
        </>
      )}

      {principles.length > 0 && (
        <>
          <Typography.Text strong>Long-term Principles</Typography.Text>
          {principles.map((p, i) => (
            <div key={i} style={{ marginTop: 8, marginBottom: 8, padding: 8, borderLeft: '3px solid #1677ff', background: '#f0f5ff', borderRadius: 4 }}>
              <Typography.Text strong>{p.title}</Typography.Text>
              <Typography.Paragraph style={{ margin: '4px 0 0' }}>{p.content}</Typography.Paragraph>
            </div>
          ))}
        </>
      )}

      {fixes.length > 0 && (
        <>
          <Typography.Text strong>Preventive Measures</Typography.Text>
          <Table
            rowKey="action"
            size="small"
            pagination={false}
            style={{ marginTop: 8 }}
            dataSource={fixes}
            columns={[
              { title: 'Action', dataIndex: 'action', key: 'action' },
              { title: 'Type', dataIndex: 'type', key: 'type', width: 100 },
              { title: 'Status', dataIndex: 'status', key: 'status', width: 80 },
            ]}
          />
        </>
      )}

      {content.summary && (
        <Typography.Paragraph style={{ marginTop: 12 }}>
          <Typography.Text strong>Summary: </Typography.Text>
          {String(content.summary)}
        </Typography.Paragraph>
      )}
    </>
  );
}

function renderFindings(findings: QAReviewFinding[]) {
  if (!findings || findings.length === 0) return null;

  const columns: ColumnsType<QAReviewFinding> = [
    {
      title: 'severity',
      dataIndex: 'severity',
      key: 'severity',
      width: 80,
      render: (val: 'critical' | 'minor') => (
        <Tag color={findingSeverityColors[val]}>{val.toUpperCase()}</Tag>
      ),
    },
    {
      title: 'category',
      dataIndex: 'category',
      key: 'category',
      width: 140,
      render: (val: string) => (
        <Tag>{findingCategoryLabels[val as keyof typeof findingCategoryLabels] ?? val}</Tag>
      ),
    },
    { title: 'description', dataIndex: 'description', key: 'description' },
  ];

  const criticalCount = findings.filter(f => f.severity === 'critical').length;
  const minorCount = findings.length - criticalCount;

  return (
    <div style={{ marginTop: 16 }}>
      <Typography.Text strong>QA Findings ({findings.length})</Typography.Text>
      <div style={{ margin: '8px 0', display: 'flex', gap: 12 }}>
        <Tag color="red">critical: {criticalCount}</Tag>
        <Tag color="orange">minor: {minorCount}</Tag>
      </div>
      <Table<QAReviewFinding>
        rowKey={(record, i) => `${record.severity}-${record.category}-${i}`}
        columns={columns}
        dataSource={findings}
        pagination={false}
        size="small"
        style={{ marginTop: 8 }}
      />
    </div>
  );
}

const renderers: Record<ReportType, (content: Record<string, unknown>) => React.ReactNode> = {
  POSTMORTEM: renderPostmortem,
  DEV_SELF_CHECK: renderDevSelfCheck,
  SECURITY_REVIEW: renderSecurityReview,
  TEST_REPORT: renderTestReport,
  CTO_REVIEW: renderCtoReview,
  DEPLOY_CONFIRM: renderDeployConfirm,
};

interface ReportDetailModalProps {
  report: RequirementReport | null;
  open: boolean;
  onClose: () => void;
}

export function ReportDetailModal({ report, open, onClose }: ReportDetailModalProps) {
  if (!report) {
    return null;
  }

  const renderer = renderers[report.reportType];

  return (
    <Modal
      title={`${reportTypeLabels[report.reportType]} - Details`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
    >
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="submitter">{report.submittedBy}</Descriptions.Item>
        <Descriptions.Item label="status">
          <Tag color={reportStatusColors[report.status]}>{reportStatusLabels[report.status]}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="submitted at">{formatDateTime(report.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="updated at">{formatDateTime(report.updatedAt)}</Descriptions.Item>
      </Descriptions>

      {renderer(report.content)}

      {report.qaFindings && report.qaFindings.length > 0 && renderFindings(report.qaFindings)}

      {report.reviewComment && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text strong>Review Comment</Typography.Text>
          <Typography.Paragraph style={{ marginTop: 4, padding: 12, background: '#fafafa', borderRadius: 6 }}>
            {report.reviewComment}
          </Typography.Paragraph>
        </div>
      )}

      {report.reviewedAt && (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          Reviewed at: {formatDateTime(report.reviewedAt)}
        </Typography.Text>
      )}
      {report.qaReviewedBy && (
        <Typography.Text type="secondary" style={{ display: 'block' }}>
          QA Reviewer: {report.qaReviewedBy} at {formatDateTime(report.qaReviewedAt)}
        </Typography.Text>
      )}
    </Modal>
  );
}
