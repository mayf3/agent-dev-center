import { Descriptions, Modal, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { RequirementReport, ReportType } from '../api/types';
import {
  reportStatusColors,
  reportStatusLabels,
  reportTypeLabels,
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

const renderers: Record<ReportType, (content: Record<string, unknown>) => React.ReactNode> = {
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
    </Modal>
  );
}
