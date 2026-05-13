import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined
} from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Tabs,
  Tag,
  Timeline,
  Typography
} from 'antd';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  listAgents,
  listTasks,
  getDashboard,
  createTask,
  updateTask,
  listDeliverables,
  createDeliverable,
  deleteDeliverable
} from '../api/marketplace';
import type {
  MarketplaceAgent,
  MarketplaceTask,
  MarketplaceDeliverable,
  MarketplaceDashboard,
  MarketplaceTaskStatus,
  DeliverableType
} from '../api/marketplace-types';
import { MarketplaceStatusTag } from '../components/MarketplaceStatusTag';
import { MarketplacePriorityTag } from '../components/MarketplacePriorityTag';
import { useAuth } from '../contexts/AuthContext';

const { TextArea } = Input;

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }
  return fallback;
}

const statusIcons: Record<string, React.ReactNode> = {
  pending: <ClockCircleOutlined />,
  processing: <RobotOutlined spin />,
  completed: <CheckCircleOutlined />,
  failed: <ExclamationCircleOutlined />
};

// === Task Detail Modal ===
function TaskDetailModal({
  task,
  open,
  onClose,
  onRefresh
}: {
  task: MarketplaceTask | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { message } = AntApp.useApp();
  const { isAuthenticated } = useAuth();
  const [deliverables, setDeliverables] = useState<MarketplaceDeliverable[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [form] = Form.useForm();

  const loadDeliverables = useCallback(async () => {
    if (!task) return;
    try {
      const data = await listDeliverables(task.id);
      setDeliverables(data);
    } catch {
      // silently ignore
    }
  }, [task]);

  useEffect(() => {
    if (open && task) {
      void loadDeliverables();
    }
  }, [open, task, loadDeliverables]);

  if (!task) return null;

  const handleAddDeliverable = async () => {
    try {
      const values = await form.validateFields();
      setAddLoading(true);
      await createDeliverable(task.id, values);
      message.success('交付物已添加');
      setAddOpen(false);
      form.resetFields();
      await loadDeliverables();
      onRefresh();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(getErrorMessage(err, '添加交付物失败'));
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteDeliverable = async (id: string) => {
    try {
      await deleteDeliverable(id);
      message.success('交付物已删除');
      await loadDeliverables();
    } catch (err) {
      message.error(getErrorMessage(err, '删除失败'));
    }
  };

  const handleStatusChange = async (newStatus: MarketplaceTaskStatus) => {
    try {
      await updateTask(task.id, { status: newStatus });
      message.success('状态已更新');
      onRefresh();
    } catch (err) {
      message.error(getErrorMessage(err, '状态更新失败'));
    }
  };

  return (
    <Modal
      title={task.title}
      open={open}
      onCancel={onClose}
      width={720}
      footer={null}
    >
      <Descriptions column={2} size="small" bordered>
        <Descriptions.Item label="Agent">
          <Space>
            <Avatar size="small">{task.agent.avatar || task.agent.displayName[0]}</Avatar>
            {task.agent.displayName}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="提交者">
          <Space><UserOutlined /> {task.requesterName}</Space>
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <MarketplaceStatusTag status={task.status} />
        </Descriptions.Item>
        <Descriptions.Item label="优先级">
          <MarketplacePriorityTag priority={task.priority} />
        </Descriptions.Item>
        <Descriptions.Item label="截止日期">
          {task.deadline ? dayjs(task.deadline).format('YYYY-MM-DD HH:mm') : '无'}
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {dayjs(task.createdAt).format('YYYY-MM-DD HH:mm')}
        </Descriptions.Item>
        <Descriptions.Item label="描述" span={2}>
          <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {task.description}
          </Typography.Paragraph>
        </Descriptions.Item>
      </Descriptions>

      {task.errorMsg && (
        <Alert message="错误信息" description={task.errorMsg} type="error" style={{ marginTop: 12 }} showIcon />
      )}

      {isAuthenticated && task.status !== 'completed' && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {task.status === 'pending' && (
            <Button type="primary" onClick={() => handleStatusChange('processing')}>开始处理</Button>
          )}
          {task.status === 'processing' && (
            <>
              <Button type="primary" onClick={() => handleStatusChange('completed')}>标记完成</Button>
              <Button danger onClick={() => handleStatusChange('failed')}>标记失败</Button>
            </>
          )}
        </div>
      )}

      <Divider orientation="left">交付物 ({deliverables.length})</Divider>

      {isAuthenticated && task.status !== 'completed' && (
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          size="small"
          onClick={() => setAddOpen(true)}
          style={{ marginBottom: 12 }}
        >
          添加交付物
        </Button>
      )}

      {deliverables.length > 0 ? (
        <Timeline>
          {deliverables.map((d) => (
            <Timeline.Item
              key={d.id}
              color={d.type === 'text' ? 'blue' : d.type === 'image' ? 'green' : d.type === 'url' ? 'cyan' : 'gray'}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space>
                    <Tag>{d.type}</Tag>
                    <Typography.Text strong>{d.title || d.type}</Typography.Text>
                  </Space>
                  {isAuthenticated && task.status !== 'completed' && (
                    <Button
                      type="text"
                      danger
                      size="small"
                      onClick={() => handleDeleteDeliverable(d.id)}
                    >
                      删除
                    </Button>
                  )}
                </div>
                <Typography.Paragraph
                  ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}
                  style={{ margin: '4px 0 0', fontSize: 13, color: '#666' }}
                >
                  {d.content}
                </Typography.Paragraph>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {dayjs(d.createdAt).format('MM-DD HH:mm')}
                </Typography.Text>
              </div>
            </Timeline.Item>
          ))}
        </Timeline>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无交付物" />
      )}

      <Modal
        title="添加交付物"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={handleAddDeliverable}
        confirmLoading={addLoading}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="type" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select
              options={[
                { label: '文本', value: 'text' },
                { label: 'URL', value: 'url' },
                { label: '图片', value: 'image' },
                { label: '文档', value: 'document' },
                { label: '文件', value: 'file' }
              ]}
            />
          </Form.Item>
          <Form.Item name="title" label="标题">
            <Input placeholder="可选标题" />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true, message: '请输入内容' }]}>
            <TextArea rows={4} placeholder="交付物内容或 URL" />
          </Form.Item>
        </Form>
      </Modal>
    </Modal>
  );
}

// === Main Page ===
export function MarketplacePage() {
  const { message } = AntApp.useApp();
  const { isAuthenticated } = useAuth();

  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<MarketplaceAgent[]>([]);
  const [tasks, setTasks] = useState<MarketplaceTask[]>([]);
  const [dashboard, setDashboard] = useState<MarketplaceDashboard | null>(null);
  const [statusFilter, setStatusFilter] = useState<MarketplaceTaskStatus | ''>('');
  const [selectedTask, setSelectedTask] = useState<MarketplaceTask | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm] = Form.useForm();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [agentList, taskResult, dash] = await Promise.all([
        listAgents(),
        listTasks({ status: statusFilter || undefined, limit: 50 }),
        getDashboard().catch(() => null)
      ]);
      setAgents(agentList);
      setTasks(taskResult.data);
      if (dash) setDashboard(dash);
    } catch (err) {
      message.error(getErrorMessage(err, '数据加载失败'));
    } finally {
      setLoading(false);
    }
  }, [message, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const taskGroups = useMemo(() => {
    const groups: Record<string, MarketplaceTask[]> = {
      pending: [],
      processing: [],
      completed: [],
      failed: [],
      cancelled: []
    };
    for (const t of tasks) {
      groups[t.status]?.push(t);
    }
    return groups;
  }, [tasks]);

  const byStatus = dashboard?.byStatus ?? {
    pending: taskGroups.pending.length,
    processing: taskGroups.processing.length,
    completed: taskGroups.completed.length,
    failed: taskGroups.failed.length,
    cancelled: taskGroups.cancelled.length
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreateLoading(true);
      await createTask({
        ...values,
        deadline: values.deadline ? values.deadline.toISOString() : undefined
      });
      message.success('任务已创建');
      setCreateOpen(false);
      createForm.resetFields();
      await loadData();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(getErrorMessage(err, '创建失败'));
    } finally {
      setCreateLoading(false);
    }
  };

  const openDetail = (task: MarketplaceTask) => {
    setSelectedTask(task);
    setDetailOpen(true);
  };

  if (loading) return <Spin className="page-spin" />;

  const kanbanColumns: { key: MarketplaceTaskStatus; title: string }[] = [
    { key: 'pending', title: '📋 待领取' },
    { key: 'processing', title: '🔧 处理中' },
    { key: 'completed', title: '✅ 已完成' },
    { key: 'failed', title: '❌ 失败' }
  ];

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>🤖 Agent 能力集市</Typography.Title>
          <Typography.Text type="secondary">管理 Agent 任务、交付物和文件上传</Typography.Text>
        </div>
        <Space>
          <Select
            allowClear
            placeholder="按状态筛选"
            style={{ width: 140 }}
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v ?? '')}
            options={[
              { label: '待领取', value: 'pending' },
              { label: '处理中', value: 'processing' },
              { label: '已完成', value: 'completed' },
              { label: '失败', value: 'failed' },
              { label: '已取消', value: 'cancelled' }
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void loadData()}>刷新</Button>
          {isAuthenticated && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              提交任务
            </Button>
          )}
        </Space>
      </div>

      {/* Stats */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="待领取" value={byStatus.pending} prefix={<ClockCircleOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="处理中" value={byStatus.processing} prefix={<RobotOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="已完成" value={byStatus.completed} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="失败" value={byStatus.failed} prefix={<ExclamationCircleOutlined />} valueStyle={{ color: '#ff4d4f' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Agent 数" value={agents.filter((a) => a.status === 'active').length} prefix={<RobotOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="任务总数" value={tasks.length} />
          </Card>
        </Col>
      </Row>

      {/* Tabs: Kanban / Agents */}
      <Tabs
        defaultActiveKey="kanban"
        items={[
          {
            key: 'kanban',
            label: '任务看板',
            children: (
              <div className="kanban-board">
                {kanbanColumns.map((col) => (
                  <section key={col.key} className="kanban-column">
                    <div className="kanban-column-title">
                      <Typography.Title level={5}>{col.title}</Typography.Title>
                      <Badge count={taskGroups[col.key]?.length ?? 0} showZero />
                    </div>
                    <div className="kanban-list" style={{ minHeight: 'auto' }}>
                      {(taskGroups[col.key] ?? []).length > 0 ? (
                        (taskGroups[col.key] ?? []).map((task) => (
                          <Card
                            key={task.id}
                            size="small"
                            className="kanban-card"
                            hoverable
                            onClick={() => openDetail(task)}
                          >
                            <div style={{ fontWeight: 600, marginBottom: 6 }}>{task.title}</div>
                            <Space size={[4, 4]} wrap>
                              <MarketplacePriorityTag priority={task.priority} />
                              <Tag>{task.agent.displayName}</Tag>
                            </Space>
                            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 6 }}>
                              <UserOutlined /> {task.requesterName} · {dayjs(task.createdAt).format('MM-DD HH:mm')}
                            </div>
                          </Card>
                        ))
                      ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />
                      )}
                    </div>
                  </section>
                ))}
              </div>
            )
          },
          {
            key: 'agents',
            label: `Agent 列表 (${agents.length})`,
            children: (
              <Row gutter={[16, 16]}>
                {agents.map((agent) => (
                  <Col xs={24} sm={12} md={8} lg={6} key={agent.id}>
                    <Card size="small" hoverable>
                      <Card.Meta
                        avatar={
                          <Avatar size={40} style={{ backgroundColor: '#1677ff' }}>
                            {agent.avatar || agent.displayName[0]}
                          </Avatar>
                        }
                        title={
                          <Space>
                            {agent.displayName}
                            <MarketplaceStatusTag status={agent.status} />
                          </Space>
                        }
                        description={
                          <>
                            <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 8 }}>
                              {agent.description}
                            </Typography.Paragraph>
                            <Space size={[4, 4]} wrap>
                              {Array.isArray(agent.capabilities) &&
                                agent.capabilities.slice(0, 3).map((cap, i) => (
                                  <Tag key={i} style={{ fontSize: 11 }}>
                                    {typeof cap === 'object' && cap !== null ? (cap as { name?: string }).name ?? JSON.stringify(cap) : String(cap)}
                                  </Tag>
                                ))}
                            </Space>
                          </>
                        }
                      />
                    </Card>
                  </Col>
                ))}
              </Row>
            )
          }
        ]}
      />

      {/* Create Task Modal */}
      <Modal
        title="提交任务"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
        onOk={handleCreate}
        confirmLoading={createLoading}
        width={560}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="agentName" label="选择 Agent" rules={[{ required: true, message: '请选择 Agent' }]}>
            <Select
              placeholder="选择要分配的 Agent"
              options={agents.filter((a) => a.status === 'active').map((a) => ({
                label: `${a.avatar || ''} ${a.displayName} (${a.name})`,
                value: a.name
              }))}
            />
          </Form.Item>
          <Form.Item name="title" label="任务标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="简短描述任务" maxLength={160} />
          </Form.Item>
          <Form.Item name="description" label="任务描述" rules={[{ required: true, message: '请输入描述' }]}>
            <TextArea rows={4} placeholder="详细描述任务需求" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="priority" label="优先级" initialValue="normal">
                <Select
                  options={[
                    { label: '低', value: 'low' },
                    { label: '普通', value: 'normal' },
                    { label: '高', value: 'high' },
                    { label: '紧急', value: 'urgent' }
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="deadline" label="截止日期">
                <DatePicker showTime style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Task Detail Modal */}
      <TaskDetailModal
        task={selectedTask}
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setSelectedTask(null); }}
        onRefresh={() => void loadData()}
      />
    </Space>
  );
}
