import {
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  SearchOutlined,
  UserOutlined
} from '@ant-design/icons';
import {
  App as AntApp,
  Button,
  Card,
  Col,
 Descriptions,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Task, TaskStatus } from '../api/types';
import {
  taskStatusLabels,
  taskStatusColors,
  priorityLabels,
  priorityColors,
  agentOptions
} from '../constants/options';
import { useAuth } from '../contexts/AuthContext';

const { TextArea } = Input;

interface TaskWithReq extends Task {
  requirement?: { id: string; title: string; status: string; priority: string };
}

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }
  return fallback;
}

export function TaskListPage() {
  const { message, modal } = AntApp.useApp();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<TaskWithReq[]>([]);

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editTask, setEditTask] = useState<TaskWithReq | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm] = Form.useForm();

  const statusFilter = searchParams.get('status') || '';
  const agentFilter = searchParams.get('agent') || '';
  const searchFilter = searchParams.get('search') || '';

  const isAdmin = user?.role === 'admin';
  const isDeveloper = user?.role === 'developer';

  const loadTasks = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      const status = searchParams.get('status');
      const agent = searchParams.get('agent');
      if (status) params.status = status;
      if (agent) params.agentType = agent;

      const { data } = await api.get<{ data: TaskWithReq[] }>('/tasks', {
        params: Object.keys(params).length > 0 ? params : undefined
      });
      const list = Array.isArray(data) ? data : data.data ?? [];
      setTasks(list);
    } catch (err) {
      message.error('加载任务列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTasks();
  }, [searchParams]);

  // Client-side search filter (by task title or requirement title)
  const filteredTasks = useMemo(() => {
    if (!searchFilter) return tasks;
    const keyword = searchFilter.toLowerCase();
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(keyword) ||
        t.requirement?.title.toLowerCase().includes(keyword) ||
        t.agentType.toLowerCase().includes(keyword)
    );
  }, [tasks, searchFilter]);

  const agentTypes = useMemo(() => {
    const set = new Set(tasks.map((t) => t.agentType));
    return Array.from(set).sort();
  }, [tasks]);

  const handleDelete = (task: TaskWithReq) => {
    modal.confirm({
      title: '确认删除任务',
      content: `确定要删除任务「${task.title}」吗？此操作不可撤销。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.delete(`/tasks/${task.id}`);
          message.success('任务已删除');
          await loadTasks();
        } catch (err) {
          message.error(getErrorMessage(err, '删除失败'));
        }
      }
    });
  };

  const openEdit = (task: TaskWithReq) => {
    setEditTask(task);
    editForm.setFieldsValue({
      title: task.title,
      description: task.description,
      agentType: task.agentType,
      status: task.status
    });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editTask) return;
    setEditLoading(true);
    try {
      const values = await editForm.validateFields();
      // Update status via PATCH
      await api.patch(`/tasks/${editTask.id}`, { status: values.status });
      message.success('任务已更新');
      setEditOpen(false);
      editForm.resetFields();
      setEditTask(null);
      await loadTasks();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(getErrorMessage(err, '更新失败'));
    } finally {
      setEditLoading(false);
    }
  };

  const columns: ColumnsType<TaskWithReq> = [
    {
      title: '任务',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string, record) => (
        <Space direction="vertical" size={2}>
          <Link to={`/requirements/${record.requirementId}`}>
            <Typography.Text strong>{title}</Typography.Text>
          </Link>
          <Typography.Text type="secondary" ellipsis style={{ maxWidth: 300, fontSize: 12 }}>
            {record.description}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: '需求',
      key: 'requirement',
      width: 200,
      ellipsis: true,
      render: (_, record) => {
        if (!record.requirement)
          return (
            <Typography.Text type="secondary">-</Typography.Text>
          );
        return (
          <Space size={4}>
            <Tag
              color={
                priorityColors[record.requirement.priority as keyof typeof priorityColors] ||
                'default'
              }
            >
              {priorityLabels[record.requirement.priority as keyof typeof priorityLabels] ||
                record.requirement.priority}
            </Tag>
            <Link to={`/requirements/${record.requirement.id}`}>
              {record.requirement.title}
            </Link>
          </Space>
        );
      }
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: TaskStatus) => (
        <Tag color={taskStatusColors[status]}>{taskStatusLabels[status]}</Tag>
      )
    },
    {
      title: '负责人',
      dataIndex: 'agentType',
      key: 'agentType',
      width: 140,
      render: (agentType: string) => (
        <span>
          <UserOutlined style={{ marginRight: 4 }} />
          {agentType}
        </span>
      )
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN')
    },
    ...(isAdmin || isDeveloper
      ? [
          {
            title: '操作',
            key: 'action',
            width: 100,
            render: (_: unknown, record: TaskWithReq) => (
              <Space size={4}>
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => openEdit(record)}
                />
                {isAdmin && (
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDelete(record)}
                  />
                )}
              </Space>
            )
          }
        ]
      : [])
  ];

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>任务列表</Typography.Title>
          <Typography.Text type="secondary">
            查看所有开发任务，按状态和负责人筛选
          </Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void loadTasks()}>
          刷新
        </Button>
      </div>

      <Card size="small">
        <Row gutter={[16, 12]} align="middle">
          <Col xs={24} sm={12} md={7}>
            <Input
              allowClear
              placeholder="搜索任务/需求标题"
              prefix={<SearchOutlined />}
              value={searchFilter}
              onChange={(e) => {
                const params = new URLSearchParams(searchParams);
                if (e.target.value) params.set('search', e.target.value);
                else params.delete('search');
                setSearchParams(params);
              }}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Space>
              <span>状态：</span>
              <Select
                allowClear
                placeholder="全部状态"
                style={{ width: 130 }}
                value={statusFilter || undefined}
                onChange={(v) => {
                  const params = new URLSearchParams(searchParams);
                  if (v) params.set('status', v);
                  else params.delete('status');
                  setSearchParams(params);
                }}
                options={[
                  { label: '待处理', value: 'todo' },
                  { label: '进行中', value: 'in-progress' },
                  { label: '测试中', value: 'testing' },
                  { label: '已完成', value: 'done' }
                ]}
              />
            </Space>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Space>
              <span>负责人：</span>
              <Select
                allowClear
                placeholder="全部"
                style={{ width: 150 }}
                value={agentFilter || undefined}
                onChange={(v) => {
                  const params = new URLSearchParams(searchParams);
                  if (v) params.set('agent', v);
                  else params.delete('agent');
                  setSearchParams(params);
                }}
                options={agentTypes.map((a) => ({ label: a, value: a }))}
              />
            </Space>
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Typography.Text type="secondary">
              共 {filteredTasks.length} 个任务
            </Typography.Text>
          </Col>
        </Row>
      </Card>

      <Card>
        {loading ? (
          <Spin />
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={filteredTasks}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (t) => `共 ${t} 条`
            }}
            scroll={{ x: 1000 }}
            expandable={{
              expandedRowRender: (record) => (
                <Descriptions size="small" bordered column={2}>
                  <Descriptions.Item label="任务 ID">
                    <Typography.Text copyable code style={{ fontSize: 12 }}>
                      {record.id}
                    </Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="需求 ID">
                    <Typography.Text
                      copyable
                      code
                      style={{ fontSize: 12 }}
                    >
                      {record.requirementId}
                    </Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="创建时间">
                    {new Date(record.createdAt).toLocaleString('zh-CN')}
                  </Descriptions.Item>
                  <Descriptions.Item label="更新时间">
                    {new Date(record.updatedAt).toLocaleString('zh-CN')}
                  </Descriptions.Item>
                  {record.description && (
                    <Descriptions.Item label="描述" span={2}>
                      {record.description}
                    </Descriptions.Item>
                  )}
                </Descriptions>
              )
            }}
          />
        )}
      </Card>

      {/* Edit Task Modal */}
      <Modal
        title="编辑任务"
        open={editOpen}
        onCancel={() => {
          setEditOpen(false);
          editForm.resetFields();
          setEditTask(null);
        }}
        onOk={() => void handleEdit()}
        confirmLoading={editLoading}
        okText="保存"
        cancelText="取消"
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="任务标题" name="title" rules={[{ required: true }]}>
            <Input disabled />
          </Form.Item>
          <Form.Item label="任务描述" name="description">
            <TextArea rows={3} disabled />
          </Form.Item>
          <Form.Item label="负责人" name="agentType">
            <Select disabled options={agentOptions.map((a) => ({ label: a, value: a }))} />
          </Form.Item>
          <Form.Item label="状态" name="status" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(taskStatusLabels) as TaskStatus[]).map((s) => ({
                label: taskStatusLabels[s],
                value: s
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
