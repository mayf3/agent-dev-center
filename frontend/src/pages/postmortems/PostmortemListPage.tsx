import { useEffect, useState } from 'react';
import {
  Card,
  Row,
  Col,
  Table,
  Tag,
  Space,
  Button,
  Select,
  DatePicker,
  Typography,
  Statistic,
  Badge,
  Modal,
  Form,
  Input,
  message,
  Tooltip,
  Popconfirm,
  Empty,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  AimOutlined,
  BugOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  postmortemsApi,
  type Postmortem,
  type PostmortemStatus,
  type PostmortemCreatePayload,
} from '../../api/postmortems';

const { Title, Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;
const { TextArea } = Input;

const STATUS_CONFIG: Record<PostmortemStatus, { label: string; color: string }> = {
  pending: { label: '待落实', color: 'red' },
  implemented: { label: '已落实', color: 'blue' },
  verified: { label: '已验证', color: 'green' },
};

function isOverdue(createdAt: string, status: string): boolean {
  if (status !== 'pending') return false;
  const created = new Date(createdAt);
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  return created <= threeDaysAgo;
}

// ─── Create / Edit Modal ───────────────────────────────────

interface PostmortemFormModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: PostmortemCreatePayload;
}

function PostmortemFormModal({ open, onClose, onSuccess, initialData }: PostmortemFormModalProps) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const isEdit = !!initialData;

  useEffect(() => {
    if (open) {
      if (initialData) {
        form.setFieldsValue(initialData);
      } else {
        form.resetFields();
      }
    }
  }, [open, initialData, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await postmortemsApi.create(values as PostmortemCreatePayload);
      message.success('验尸报告创建成功');
      onClose();
      onSuccess();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error('创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="创建验尸报告"
      open={open}
      onOk={handleSubmit}
      onCancel={onClose}
      confirmLoading={loading}
      width={700}
      okText="创建"
    >
      <Form form={form} layout="vertical">
        <Form.Item name="title" label="事故标题" rules={[{ required: true, message: '请输入事故标题' }]}>
          <Input placeholder="简要描述事故" />
        </Form.Item>
        <Form.Item name="requirementId" label="关联需求 ID（可选）">
          <Input placeholder="需求完整 UUID" />
        </Form.Item>
        <Form.Item name="phenomenon" label="现象描述" rules={[{ required: true, message: '请描述事故现象' }]}>
          <TextArea rows={3} placeholder="发生了什么？用户/系统看到什么？" />
        </Form.Item>
        <Form.Item name="rootCause" label="根因分析（至少3个为什么）" rules={[{ required: true }]}>
          <TextArea rows={4} placeholder="1. 为什么出现这个bug？&#10;2. 为什么代码review没发现？&#10;3. 为什么测试用例没覆盖？" />
        </Form.Item>
        <Form.Item name="whyExistingProcess" label="为什么现有流程没拦住">
          <TextArea rows={3} placeholder="CI/CD pipeline、code review、测试流程在哪一环失效了？" />
        </Form.Item>
        <Form.Item name="longTermPrinciple" label="提取的长期原则">
          <TextArea rows={2} placeholder="这次事故告诉我们什么长期该做的事？" />
        </Form.Item>
        <Form.Item name="preventionMeasures" label="预防措施" rules={[{ required: true, message: '请填写预防措施' }]}>
          <TextArea rows={3} placeholder="具体怎么做才能避免重蹈覆辙？" />
        </Form.Item>
        <Form.Item name="responsiblePerson" label="责任人" rules={[{ required: true }]}>
          <Input placeholder="谁负责落实预防措施？" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ─── Main Page ─────────────────────────────────────────────

export function PostmortemListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [postmortems, setPostmortems] = useState<Postmortem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ thisMonth: 0, total: 0, overdue: 0, byStatus: [] as { status: string; count: number }[] });
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [personFilter, setPersonFilter] = useState<string | undefined>();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Auto-open create modal from URL param
  useEffect(() => {
    const createParam = searchParams.get('create');
    if (createParam === 'true') {
      setCreateModalOpen(true);
    }
  }, [searchParams]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), pageSize: '20' };
      if (statusFilter) params.status = statusFilter;
      if (personFilter) params.responsiblePerson = personFilter;

      const [listRes, statsRes] = await Promise.all([
        postmortemsApi.list(params),
        postmortemsApi.getStats(),
      ]);
      setPostmortems(listRes.data.postmortems);
      setTotal(listRes.data.total);
      setStats(statsRes.data);
    } catch {
      message.error('加载验尸报告失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, statusFilter, personFilter]);

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      width: 300,
      render: (title: string, record: Postmortem) => (
        <Space>
          {isOverdue(record.createdAt, record.status) && (
            <Tooltip title="超过3天未落实">
              <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
            </Tooltip>
          )}
          <a onClick={() => setDetailId(record.id)}>{title}</a>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: PostmortemStatus, record: Postmortem) => {
        const cfg = STATUS_CONFIG[status] || { label: status, color: 'default' };
        return (
          <Badge
            status={isOverdue(record.createdAt, record.status) ? 'error' : (cfg.color as any)}
            text={cfg.label}
          />
        );
      },
    },
    {
      title: '责任人',
      dataIndex: 'responsiblePerson',
      key: 'responsiblePerson',
      width: 120,
    },
    {
      title: '关联需求',
      dataIndex: 'requirement',
      key: 'requirementId',
      width: 200,
      ellipsis: true,
      render: (req: { id: string; title: string } | null) =>
        req ? (
          <Tooltip title={req.title}>
            <a onClick={() => navigate(`/requirements/${req.id}`)}>
              {req.title.slice(0, 30)}...
            </a>
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (date: string) => dayjs(date).format('MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: Postmortem) => (
        <Space>
          <Button
            type="link"
            size="small"
            onClick={() => {
              navigate(`/postmortems/${record.id}`);
            }}
          >
            详情
          </Button>
          {record.status === 'pending' && (
            <Popconfirm
              title="确认归档？报告将移至归档目录，可恢复。"
              onConfirm={async () => {
                await postmortemsApi.delete(record.id);
                message.success('已归档');
                fetchData();
              }}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Space>
          <BugOutlined style={{ fontSize: 24, color: '#1677ff' }} />
          <Title level={3} style={{ margin: 0 }}>验尸报告</Title>
          {stats.overdue > 0 && (
            <Tag color="red" style={{ marginLeft: 8 }}>
              逾期 {stats.overdue} 项
            </Tag>
          )}
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
          创建验尸报告
        </Button>
      </div>

      {/* Stats Cards */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="本月事故" value={stats.thisMonth} prefix={<BugOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="待落实" value={stats.byStatus.find(s => s.status === 'pending')?.count || 0} valueStyle={{ color: stats.overdue > 0 ? '#ff4d4f' : '#faad14' }} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="已落实" value={stats.byStatus.find(s => s.status === 'implemented')?.count || 0} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="已验证" value={stats.byStatus.find(s => s.status === 'verified')?.count || 0} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
      </Row>

      {/* Filters */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            placeholder="落实状态"
            allowClear
            style={{ width: 130 }}
            value={statusFilter}
            onChange={(val) => { setStatusFilter(val); setPage(1); }}
            options={[
              { label: '待落实', value: 'pending' },
              { label: '已落实', value: 'implemented' },
              { label: '已验证', value: 'verified' },
            ]}
          />
          <Select
            placeholder="责任人"
            allowClear
            style={{ width: 130 }}
            value={personFilter}
            onChange={(val) => { setPersonFilter(val); setPage(1); }}
            options={[...new Set(postmortems.map(p => p.responsiblePerson))].map(p => ({ label: p, value: p }))}
          />
        </Space>
      </Card>

      {/* Table */}
      <Table
        dataSource={postmortems}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          onChange: setPage,
          showTotal: (t) => `共 ${t} 条`,
        }}
        locale={{ emptyText: <Empty description="暂无验尸报告" /> }}
      />

      {/* Create Modal */}
      <PostmortemFormModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={fetchData}
      />

      {/* Quick Detail Modal */}
      {detailId && <PostmortemDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

// ─── Quick Detail Modal ────────────────────────────────────

function PostmortemDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [postmortem, setPostmortem] = useState<Postmortem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    postmortemsApi.get(id).then((res) => {
      setPostmortem(res.data.postmortem);
    }).catch(() => {
      message.error('加载失败');
    }).finally(() => {
      setLoading(false);
    });
  }, [id]);

  return (
    <Modal
      title="验尸报告详情"
      open
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button type="primary" onClick={() => {
            onClose();
            window.location.href = `/postmortems/${id}`;
          }}>
            查看完整详情
          </Button>
        </Space>
      }
      width={700}
    >
      <Spin spinning={loading}>
        {postmortem && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Title level={5}>{postmortem.title}</Title>
            <Tag color={STATUS_CONFIG[postmortem.status]?.color || 'default'}>
              {STATUS_CONFIG[postmortem.status]?.label || postmortem.status}
            </Tag>

            <div>
              <Text strong>现象描述：</Text>
              <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{postmortem.phenomenon}</Paragraph>
            </div>
            <div>
              <Text strong>根因分析：</Text>
              <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{postmortem.rootCause}</Paragraph>
            </div>
            <div>
              <Text strong>预防措施：</Text>
              <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{postmortem.preventionMeasures}</Paragraph>
            </div>
            <div>
              <Text strong>责任人：</Text>
              <Text>{postmortem.responsiblePerson}</Text>
            </div>
            {postmortem.requirement && (
              <div>
                <Text strong>关联需求：</Text>
                <Text>{postmortem.requirement.title}</Text>
              </div>
            )}
          </Space>
        )}
      </Spin>
    </Modal>
  );
}
