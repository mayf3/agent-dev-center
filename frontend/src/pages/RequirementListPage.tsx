import { EyeOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import {
  App as AntApp,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Table,
  Typography
} from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type {
  PaginatedResponse,
  Requirement,
  RequirementPriority,
  RequirementStatus
} from '../api/types';
import { PriorityTag } from '../components/PriorityTag';
import { StatusTag } from '../components/StatusTag';
import { priorityLabels, statusLabels } from '../constants/options';
import { useAuth } from '../contexts/AuthContext';

interface FilterValues {
  search?: string;
  status?: RequirementStatus;
  priority?: RequirementPriority;
}

export function RequirementListPage() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [form] = Form.useForm<FilterValues>();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 10,
    total: 0,
    showSizeChanger: true
  });

  const fetchRequirements = async (
    page = pagination.current ?? 1,
    pageSize = pagination.pageSize ?? 10
  ) => {
    setLoading(true);
    try {
      const filters = form.getFieldsValue();
      const { data } = await api.get<PaginatedResponse<Requirement>>('/requirements', {
        params: {
          page,
          pageSize,
          ...filters
        }
      });
      setRequirements(data.data);
      setPagination((current) => ({
        ...current,
        current: data.meta.page,
        pageSize: data.meta.pageSize,
        total: data.meta.total
      }));
    } catch {
      message.error('需求列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRequirements(1, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns: ColumnsType<Requirement> = [
    {
      title: '需求标题',
      dataIndex: 'title',
      render: (_, record) => <Link to={`/requirements/${record.id}`}>{record.title}</Link>
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 120,
      render: (priority) => <PriorityTag priority={priority} />
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (status) => <StatusTag status={status} />
    },
    {
      title: '业务线',
      dataIndex: 'department',
      width: 140
    },
    {
      title: '提交者',
      dataIndex: 'requester',
      width: 140
    },
    {
      title: '负责人',
      dataIndex: 'assignee',
      width: 160,
      render: (assignee) => assignee || '未分配'
    },
    {
      title: '截止时间',
      dataIndex: 'dueDate',
      width: 140,
      render: (value) => (value ? dayjs(value).format('YYYY-MM-DD') : '未设置')
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 96,
      render: (_, record) => (
        <Button
          type="text"
          icon={<EyeOutlined />}
          onClick={() => navigate(`/requirements/${record.id}`)}
        >
          查看
        </Button>
      )
    }
  ];

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>需求列表</Typography.Title>
          <Typography.Text type="secondary">按状态、优先级和关键词筛选需求</Typography.Text>
        </div>
        {isAuthenticated && (
          <Button type="primary" onClick={() => navigate('/requirements/new')}>
            提交需求
          </Button>
        )}
      </div>

      <Card>
        <Form form={form} layout="inline" className="filter-bar" onFinish={() => fetchRequirements(1)}>
          <Form.Item name="search">
            <Input allowClear prefix={<SearchOutlined />} placeholder="搜索标题、描述、业务线" />
          </Form.Item>
          <Form.Item name="status">
            <Select
              allowClear
              placeholder="状态"
              style={{ width: 150 }}
              options={(Object.keys(statusLabels) as RequirementStatus[]).map((status) => ({
                value: status,
                label: statusLabels[status]
              }))}
            />
          </Form.Item>
          <Form.Item name="priority">
            <Select
              allowClear
              placeholder="优先级"
              style={{ width: 140 }}
              options={(Object.keys(priorityLabels) as RequirementPriority[]).map((priority) => ({
                value: priority,
                label: priorityLabels[priority]
              }))}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
                筛选
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  form.resetFields();
                  void fetchRequirements(1);
                }}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={requirements}
          loading={loading}
          pagination={pagination}
          scroll={{ x: 1100 }}
          onChange={(nextPagination) =>
            fetchRequirements(nextPagination.current, nextPagination.pageSize)
          }
        />
      </Card>
    </Space>
  );
}
