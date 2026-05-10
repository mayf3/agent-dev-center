import { ReloadOutlined, UserOutlined } from '@ant-design/icons';
import {
  App as AntApp,
  Badge,
  Button,
  Card,
  Col,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Task, TaskStatus } from '../api/types';
import { taskStatusLabels, taskStatusColors, priorityLabels, priorityColors, statusLabels, statusColors } from '../constants/options';
import { useAuth } from '../contexts/AuthContext';

export function TaskListPage() {
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);

  const statusFilter = searchParams.get('status') || '';
  const agentFilter = searchParams.get('agent') || '';

  const loadTasks = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      const status = searchParams.get('status');
      const agent = searchParams.get('agent');
      if (status) params.status = status;
      if (agent) params.agentType = agent;

      const { data } = await api.get<{ data: Task[] }>('/tasks', { params: Object.keys(params).length > 0 ? params : undefined });
      setTasks(Array.isArray(data) ? data : data.data ?? []);
    } catch (err) {
      message.error('加载任务列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTasks();
  }, [searchParams]);

  const agentTypes = useMemo(() => {
    const set = new Set(tasks.map((t) => t.agentType));
    return Array.from(set).sort();
  }, [tasks]);

  const columns: ColumnsType<Task & { requirement?: { id: string; title: string; status: string; priority: string } }> = [
    {
      title: '任务',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string, record) => (
        <Link to={`/requirements/${record.requirementId}`}>{title}</Link>
      ),
    },
    {
      title: '需求',
      key: 'requirement',
      width: 200,
      ellipsis: true,
      render: (_, record) => {
        const req = (record as { requirement?: { id: string; title: string; status: string; priority: string } }).requirement;
        if (!req) return <Typography.Text type="secondary">-</Typography.Text>;
        return (
          <Space size={4}>
            <Tag color={priorityColors[req.priority as keyof typeof priorityColors] || 'default'}>
              {priorityLabels[req.priority as keyof typeof priorityLabels] || req.priority}
            </Tag>
            <Link to={`/requirements/${req.id}`}>{req.title}</Link>
          </Space>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: TaskStatus) => (
        <Tag color={taskStatusColors[status]}>{taskStatusLabels[status]}</Tag>
      ),
    },
    {
      title: '负责人',
      dataIndex: 'agentType',
      key: 'agentType',
      width: 140,
      render: (agentType: string) => (
        <span><UserOutlined style={{ marginRight: 4 }} />{agentType}</span>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
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
        <Row gutter={[16, 12]}>
          <Col xs={24} sm={12} md={8}>
            <Space>
              <span>状态：</span>
              <Select
                allowClear
                placeholder="全部状态"
                style={{ width: 140 }}
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
                  { label: '已完成', value: 'done' },
                ]}
              />
            </Space>
          </Col>
          <Col xs={24} sm={12} md={8}>
            <Space>
              <span>负责人：</span>
              <Select
                allowClear
                placeholder="全部负责人"
                style={{ width: 160 }}
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
          <Col xs={24} sm={24} md={8}>
            <Typography.Text type="secondary">
              共 {tasks.length} 个任务
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
            dataSource={tasks}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
            scroll={{ x: 1000 }}
          />
        )}
      </Card>
    </Space>
  );
}
