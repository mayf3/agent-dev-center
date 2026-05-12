import { CheckOutlined, CloseOutlined, EyeOutlined, ReloadOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons';
import {
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography
} from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type {
  PaginatedResponse,
  Requirement,
  RequirementPriority,
  RequirementStatus,
  User
} from '../api/types';
import { PriorityTag } from '../components/PriorityTag';
import { StatusTag } from '../components/StatusTag';
import { priorityLabels, statusLabels } from '../constants/options';
import { useAuth } from '../contexts/AuthContext';

interface FilterValues {
  search?: string;
  status?: RequirementStatus;
  priority?: RequirementPriority;
  assignee?: string;
  department?: string;
  my?: string;
}

export function RequirementListPage() {
  const { message, modal } = AntApp.useApp();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm<FilterValues>();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 10,
    total: 0,
    showSizeChanger: true
  });

  // === Tab / View mode ===
  const tabValue = useMemo(() => {
    return searchParams.get('my') === '1' ? 'my' : 'all';
  }, [searchParams]);

  // === Fetch users for assignee filter ===
  useEffect(() => {
    api.get<{ data: User[] }>('/requirements/users/list').then(({ data }) => {
      setUsers(data.data || []);
    }).catch(() => {});
  }, []);

  // === Fetch departments from loaded data ===
  useEffect(() => {
    const deps = new Set(requirements.map(r => r.department).filter(Boolean));
    setDepartments(Array.from(deps));
  }, [requirements]);

  const fetchRequirements = useCallback(async (
    page = pagination.current ?? 1,
    pageSize = pagination.pageSize ?? 10
  ) => {
    setLoading(true);
    try {
      const filters = form.getFieldsValue();
      const params: Record<string, unknown> = {
        page,
        pageSize,
        search: filters.search,
        status: filters.status,
        priority: filters.priority,
        assignee: filters.assignee,
        department: filters.department,
      };

      // Personal view: filter by current user
      if (tabValue === 'my' && user) {
        params.assignee = user.name;
      }

      const { data } = await api.get<PaginatedResponse<Requirement>>('/requirements', { params });
      setRequirements(data.data);
      setPagination((current) => ({
        ...current,
        current: data.meta.page,
        pageSize: data.meta.pageSize,
        total: data.meta.total
      }));
      setSelectedRowKeys([]);
    } catch {
      message.error('需求列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [pagination, tabValue, user, form, message]);

  useEffect(() => {
    void fetchRequirements(1, 10);
  }, [tabValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // === Batch operations ===
  const handleBatchStatus = (status: RequirementStatus, rejectReason?: string) => {
    modal.confirm({
      title: `批量${status === 'approved' ? '通过' : status === 'rejected' ? '拒绝' : '流转'}`,
      content: `确定将选中的 ${selectedRowKeys.length} 个需求状态变更为「${statusLabels[status] || status}」吗？`,
      onOk: async () => {
        try {
          await api.post('/requirements/batch-status', {
            ids: selectedRowKeys,
            status,
            rejectReason
          });
          message.success(`已更新 ${selectedRowKeys.length} 个需求`);
          setSelectedRowKeys([]);
          void fetchRequirements(1);
        } catch (err: any) {
          message.error(err.response?.data?.message || '批量操作失败');
        }
      }
    });
  };

  const handleBatchReject = () => {
    let reason = '';
    modal.confirm({
      title: '批量拒绝',
      content: (
        <Input.TextArea
          placeholder="请输入拒绝原因..."
          rows={3}
          onChange={(e) => { reason = e.target.value; }}
        />
      ),
      onOk: async () => {
        if (!reason) {
          message.error('拒绝时必须填写原因');
          throw new Error('missing reason');
        }
        await api.post('/requirements/batch-status', {
          ids: selectedRowKeys,
          status: 'rejected',
          rejectReason: reason
        });
        message.success(`已拒绝 ${selectedRowKeys.length} 个需求`);
        setSelectedRowKeys([]);
        void fetchRequirements(1);
      }
    });
  };

  // === Columns ===
  const columns: ColumnsType<Requirement> = [
    // Checkbox column for batch operations
    ...(isAuthenticated ? [{
      title: <Checkbox
        indeterminate={selectedRowKeys.length > 0 && selectedRowKeys.length < requirements.length}
        checked={requirements.length > 0 && selectedRowKeys.length === requirements.length}
        onChange={(e) => {
          if (e.target.checked) {
            setSelectedRowKeys(requirements.map(r => r.id));
          } else {
            setSelectedRowKeys([]);
          }
        }}
      />,
      dataIndex: 'id' as const,
      key: 'selection',
      width: 48,
      render: (id: string) => (
        <Checkbox
          checked={selectedRowKeys.includes(id)}
          onChange={(e) => {
            if (e.target.checked) {
              setSelectedRowKeys(prev => [...prev, id]);
            } else {
              setSelectedRowKeys(prev => prev.filter(k => k !== id));
            }
          }}
        />
      ),
    }] : []),
    {
      title: '需求标题',
      dataIndex: 'title',
      render: (_, record) => <Link to={`/requirements/${record.id}`}>{record.title}</Link>
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 100,
      render: (priority) => <PriorityTag priority={priority} />
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status) => <StatusTag status={status} />
    },
    {
      title: '业务线',
      dataIndex: 'department',
      width: 130,
    },
    {
      title: '提交者',
      dataIndex: 'requester',
      width: 130,
    },
    {
      title: '负责人',
      dataIndex: 'assignee',
      width: 140,
      render: (assignee) => assignee ? (
        <Tag icon={<UserOutlined />} color="default">{assignee}</Tag>
      ) : (
        <Typography.Text type="secondary">未分配</Typography.Text>
      )
    },
    {
      title: '截止时间',
      dataIndex: 'dueDate',
      width: 120,
      render: (value) => value ? dayjs(value).format('MM-DD') : '-'
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 80,
      render: (_, record) => (
        <Tooltip title="查看详情">
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/requirements/${record.id}`)}
          />
        </Tooltip>
      )
    }
  ];

  const rowSelectionCount = selectedRowKeys.length;

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {tabValue === 'my' ? '我的任务' : '需求列表'}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
            {tabValue === 'my' ? '仅显示分配给我的需求和任务' : '按状态、优先级、负责人和关键词筛选需求'}
          </Typography.Text>
        </div>
        {isAuthenticated && (
          <Button type="primary" onClick={() => navigate('/requirements/new')}>
            提交需求
          </Button>
        )}
      </div>

      {/* Tabs: All / My Tasks */}
      {isAuthenticated && (
        <Tabs
          activeKey={tabValue}
          onChange={(key) => {
            navigate(key === 'my' ? '?my=1' : window.location.pathname, { replace: true });
            setSelectedRowKeys([]);
          }}
          items={[
            { key: 'all', label: '📋 所有需求' },
            { key: 'my', label: <><UserOutlined /> 我的任务</> },
          ]}
        />
      )}

      <Card>
        <Form form={form} layout="inline" className="filter-bar" onFinish={() => fetchRequirements(1)}>
          <Form.Item name="search" style={{ minWidth: 200 }}>
            <Input allowClear prefix={<SearchOutlined />} placeholder="搜索标题、描述、业务线..." />
          </Form.Item>
          <Form.Item name="status">
            <Select
              allowClear
              placeholder="状态"
              style={{ width: 130 }}
              options={(Object.keys(statusLabels) as RequirementStatus[]).map((s) => ({
                value: s,
                label: statusLabels[s]
              }))}
            />
          </Form.Item>
          <Form.Item name="priority">
            <Select
              allowClear
              placeholder="优先级"
              style={{ width: 120 }}
              options={(Object.keys(priorityLabels) as RequirementPriority[]).map((p) => ({
                value: p,
                label: priorityLabels[p]
              }))}
            />
          </Form.Item>
          <Form.Item name="assignee">
            <Select
              allowClear
              placeholder="负责人"
              style={{ width: 140 }}
              options={users
                .filter(u => u.role !== 'requester')
                .map(u => ({ value: u.name, label: u.name }))}
            />
          </Form.Item>
          {departments.length > 0 && (
            <Form.Item name="department">
              <Select
                allowClear
                placeholder="业务线"
                style={{ width: 140 }}
                options={departments.map(d => ({ value: d, label: d }))}
              />
            </Form.Item>
          )}
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

      {/* Batch actions bar */}
      {rowSelectionCount > 0 && isAuthenticated && (
        <Card size="small" style={{ background: '#e6f4ff', border: '1px solid #91caff' }}>
          <Space>
            <Typography.Text strong>
              已选 {rowSelectionCount} 项
            </Typography.Text>
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              onClick={() => handleBatchStatus('approved' as RequirementStatus)}
            >
              批量通过
            </Button>
            <Button
              size="small"
              icon={<CloseOutlined />}
              danger
              onClick={handleBatchReject}
            >
              批量拒绝
            </Button>
            <Button
              size="small"
              onClick={() => handleBatchStatus('in-progress' as RequirementStatus)}
            >
              批量开始开发
            </Button>
            <Button
              size="small"
              onClick={() => setSelectedRowKeys([])}
            >
              取消选择
            </Button>
          </Space>
        </Card>
      )}

      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={requirements}
          loading={loading}
          pagination={pagination}
          scroll={{ x: 1000 }}
          onChange={(nextPagination) =>
            fetchRequirements(nextPagination.current, nextPagination.pageSize)
          }
          size="middle"
        />
      </Card>
    </Space>
  );
}
