import { CheckOutlined, CloseOutlined, EyeOutlined, ProjectOutlined, ReloadOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons';
import {
  App as AntApp,
  Badge,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Progress,
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
import { api } from '../../api/client';
import type {
  PaginatedResponse,
  Requirement,
  RequirementPriority,
  RequirementStatus,
  User
} from '../../api/types';
import { PriorityTag } from '../../components/PriorityTag';
import { StatusTag } from '../../components/StatusTag';
import { priorityLabels, statusLabels } from '../../constants/options';
import { useAuth } from '../../contexts/AuthContext';

interface FilterValues {
  search?: string;
  status?: RequirementStatus;
  priority?: RequirementPriority;
  assignee?: string;
  department?: string;
}

function taskProgress(requirement: Requirement) {
  const tasks = requirement.tasks ?? [];
  const done = tasks.filter((task) => task.status === 'done').length;
  const total = tasks.length;
  return {
    done,
    total,
    percent: total > 0 ? Math.round((done / total) * 100) : 0
  };
}

function dueDateLabel(requirement: Requirement) {
  return requirement.dueDate ? dayjs(requirement.dueDate).format('YYYY-MM-DD') : '未设置截止时间';
}

const MOBILE_CARD_SKELETON_KEYS = ['mobile-card-skeleton-1', 'mobile-card-skeleton-2', 'mobile-card-skeleton-3'];

function MobileCardSkeleton() {
  return (
    <div className="mobile-req-card mobile-req-card-skeleton" aria-hidden="true">
      <div className="mobile-card-skeleton-line mobile-card-skeleton-title" />
      <div className="mobile-card-skeleton-meta">
        <span className="mobile-card-skeleton-pill" />
        <span className="mobile-card-skeleton-pill" />
        <span className="mobile-card-skeleton-line mobile-card-skeleton-short" />
      </div>
    </div>
  );
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
  const [isMobile, setIsMobile] = useState(false);
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 10,
    total: 0,
    showSizeChanger: true
  });

  const tabValue = useMemo(() => {
    const t = searchParams.get('tab');
    if (t === 'mine') return 'mine';
    if (t === 'my') return 'my';
    return 'all';
  }, [searchParams]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    api.get<{ data: User[] }>('/requirements/users/list').then(({ data }) => {
      setUsers(data.data || []);
    }).catch(() => {});
  }, []);

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
        page, pageSize,
        search: filters.search,
        status: filters.status,
        priority: filters.priority,
        assignee: filters.assignee,
        department: filters.department,
      };
      if (tabValue === 'my' && user) {
        params.assignee = user.name;
      }
      // "我提交的" — requester role already filtered by backend roleAwareRequirementWhere
      // For admin/dev users, we filter by requester name on frontend
      const { data } = await api.get<PaginatedResponse<Requirement>>('/requirements', { params });
      let filtered = data.data;
      if (tabValue === 'mine' && user) {
        filtered = filtered.filter((r: Requirement) => r.requester === user.name);
      }
      setRequirements(filtered);
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

  const submittedCount = useMemo(() => {
    if (!user) return 0;
    if (tabValue === 'mine') return requirements.length;
    return requirements.filter((requirement) => requirement.requester === user.name).length;
  }, [requirements, tabValue, user]);

  // Batch operations
  const handleBatchStatus = (status: RequirementStatus) => {
    modal.confirm({
      title: `批量${status === 'approved' ? '通过' : status === 'rejected' ? '拒绝' : '流转'}`,
      content: `确定将选中的 ${selectedRowKeys.length} 个需求状态变更为「${statusLabels[status] || status}」吗？`,
      onOk: async () => {
        try {
          await api.post('/requirements/batch-status', { ids: selectedRowKeys, status });
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
      content: <Input.TextArea placeholder="请输入拒绝原因..." rows={3} onChange={(e) => { reason = e.target.value; }} />,
      onOk: async () => {
        if (!reason) { message.error('拒绝时必须填写原因'); throw new Error('missing reason'); }
        await api.post('/requirements/batch-status', { ids: selectedRowKeys, status: 'rejected', rejectReason: reason });
        message.success(`已拒绝 ${selectedRowKeys.length} 个需求`);
        setSelectedRowKeys([]);
        void fetchRequirements(1);
      }
    });
  };

  // Desktop table columns
  const columns: ColumnsType<Requirement> = [
    ...(isAuthenticated ? [{
      title: <Checkbox
        indeterminate={selectedRowKeys.length > 0 && selectedRowKeys.length < requirements.length}
        checked={requirements.length > 0 && selectedRowKeys.length === requirements.length}
        onChange={(e) => setSelectedRowKeys(e.target.checked ? requirements.map(r => r.id) : [])}
      />,
      dataIndex: 'id' as const,
      key: 'selection',
      width: 48,
      render: (id: string) => (
        <Checkbox
          checked={selectedRowKeys.includes(id)}
          onChange={(e) => {
            if (e.target.checked) setSelectedRowKeys(prev => [...prev, id]);
            else setSelectedRowKeys(prev => prev.filter(k => k !== id));
          }}
        />
      ),
    }] : []),
    {
      title: '需求标题',
      dataIndex: 'title',
      width: 420,
      render: (_, record) => {
        const progress = taskProgress(record);
        return (
          <Tooltip
            title={
              <Space direction="vertical" size={0}>
                <span>截止：{dueDateLabel(record)}</span>
                <span>任务完成：{progress.done}/{progress.total}</span>
              </Space>
            }
          >
            <Link className="requirement-title-link" to={`/requirements/${record.id}`}>
              {record.title}
            </Link>
          </Tooltip>
        );
      }
    },
    { title: '优先级', dataIndex: 'priority', width: 100, render: (p) => <PriorityTag priority={p} /> },
    { title: '状态', dataIndex: 'status', width: 100, render: (s) => <StatusTag status={s} /> },
    {
      title: '进度',
      key: 'progress',
      width: 150,
      render: (_, record) => {
        const progress = taskProgress(record);
        if (progress.total === 0) {
          return <Typography.Text type="secondary">暂无任务</Typography.Text>;
        }
        return (
          <Tooltip title={`已完成 ${progress.done}/${progress.total} 个任务`}>
            <div className="requirement-progress-cell">
              <Progress
                percent={progress.percent}
                showInfo={false}
                size="small"
                status={progress.percent === 100 ? 'success' : 'active'}
              />
              <Typography.Text type="secondary" className="requirement-progress-meta">
                {progress.percent}%
              </Typography.Text>
            </div>
          </Tooltip>
        );
      }
    },
    { title: '提交者', dataIndex: 'requester', width: 130 },
    {
      title: '负责人', dataIndex: 'assignee', width: 140,
      render: (a) => a ? <Tag icon={<UserOutlined />} color="default">{a}</Tag> : <Typography.Text type="secondary">未分配</Typography.Text>
    },
    {
      title: '操作', key: 'action', fixed: 'right', width: 80,
      render: (_, record) => (
        <Tooltip title="查看详情">
          <Button type="text" icon={<EyeOutlined />} onClick={() => navigate(`/requirements/${record.id}`)} />
        </Tooltip>
      )
    }
  ];

  const rowSelectionCount = selectedRowKeys.length;

  // Mobile card item
  const MobileCard = ({ item }: { item: Requirement }) => (
    <div className="mobile-req-card" onClick={() => navigate(`/requirements/${item.id}`)}>
      <div className="mobile-req-card-title">{item.title}</div>
      <div className="mobile-req-card-meta">
        <PriorityTag priority={item.priority} />
        <StatusTag status={item.status} />
        {item.assignee && <Tag icon={<UserOutlined />}>{item.assignee}</Tag>}
        {item.dueDate && <span>{dayjs(item.dueDate).format('MM-DD')}</span>}
      </div>
    </div>
  );

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {tabValue === 'mine' ? '我提交的需求' : tabValue === 'my' ? '分配给我的需求' : '需求列表'}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
            {tabValue === 'mine' ? '查看我提交的所有需求及状态' : tabValue === 'my' ? '仅显示分配给我的需求和任务' : '按状态、优先级、负责人和关键词筛选需求'}
          </Typography.Text>
        </div>
        {isAuthenticated && (
          <Space>
            <Button icon={<ProjectOutlined />} onClick={() => navigate('/kanban')}>
              看板视图
            </Button>
            <Button type="primary" onClick={() => navigate('/requirements/new')}>
              {isMobile ? '提交' : '提交需求'}
            </Button>
          </Space>
        )}
      </div>

      {isAuthenticated && (
        <Tabs
          activeKey={tabValue}
          onChange={(key) => {
            const tabParam = key === 'all' ? '' : key;
            navigate(tabParam ? `?tab=${tabParam}` : window.location.pathname, { replace: true });
            setSelectedRowKeys([]);
          }}
          items={[
            { key: 'all', label: '📋 所有需求' },
            {
              key: 'mine',
              label: (
                <Space size={6}>
                  <UserOutlined />
                  <span>我提交的</span>
                  <Badge count={submittedCount} overflowCount={99} size="small" showZero />
                </Space>
              )
            },
            { key: 'my', label: <><UserOutlined /> 分配给我</> },
          ]}
          size={isMobile ? 'small' : 'middle'}
        />
      )}

      <Card size={isMobile ? 'small' : 'default'}>
        <Form form={form} layout="inline" className="filter-bar" onFinish={() => fetchRequirements(1)}>
          <Form.Item name="search" style={{ minWidth: isMobile ? 0 : 200 }}>
            <Input allowClear prefix={<SearchOutlined />} placeholder="搜索..." />
          </Form.Item>
          <Form.Item name="status">
            <Select
              allowClear placeholder="状态"
              style={{ width: isMobile ? '100%' : 130 }}
              options={(Object.keys(statusLabels) as RequirementStatus[]).map((s) => ({ value: s, label: statusLabels[s] }))}
            />
          </Form.Item>
          {!isMobile && (
            <>
              <Form.Item name="priority">
                <Select
                  allowClear placeholder="优先级" style={{ width: 120 }}
                  options={(Object.keys(priorityLabels) as RequirementPriority[]).map((p) => ({ value: p, label: priorityLabels[p] }))}
                />
              </Form.Item>
              <Form.Item name="assignee">
                <Select
                  allowClear placeholder="负责人" style={{ width: 140 }}
                  options={users.filter(u => u.role !== 'requester').map(u => ({ value: u.name, label: u.name }))}
                />
              </Form.Item>
            </>
          )}
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
                筛选
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => { form.resetFields(); void fetchRequirements(1); }}>
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {/* Batch actions bar */}
      {rowSelectionCount > 0 && isAuthenticated && !isMobile && (
        <Card size="small" style={{ background: '#e6f4ff', border: '1px solid #91caff' }}>
          <Space>
            <Typography.Text strong>已选 {rowSelectionCount} 项</Typography.Text>
            <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => handleBatchStatus('approved' as RequirementStatus)}>批量通过</Button>
            <Button size="small" icon={<CloseOutlined />} danger onClick={handleBatchReject}>批量拒绝</Button>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
          </Space>
        </Card>
      )}

      {/* Mobile batch bar */}
      {rowSelectionCount > 0 && isAuthenticated && isMobile && (
        <div className="mobile-batch-bar">
          <Typography.Text strong>已选 {rowSelectionCount} 项</Typography.Text>
          <Space size={4}>
            <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => handleBatchStatus('approved' as RequirementStatus)}>通过</Button>
            <Button size="small" danger icon={<CloseOutlined />} onClick={handleBatchReject}>拒绝</Button>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>取消</Button>
          </Space>
        </div>
      )}

      {/* Desktop: Table */}
      <Card className="desktop-table-view">
        <Table
          rowKey="id" columns={columns} dataSource={requirements} loading={loading}
          className="requirement-table"
          pagination={pagination} scroll={{ x: 960 }} size="middle"
          onChange={(p) => fetchRequirements(p.current, p.pageSize)}
        />
      </Card>

      {/* Mobile: Card list */}
      <div className="mobile-card-list">
        {loading ? (
          MOBILE_CARD_SKELETON_KEYS.map((key) => <MobileCardSkeleton key={key} />)
        ) : (
          requirements.map((item) => <MobileCard key={item.id} item={item} />)
        )}
        {requirements.length > 0 && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <Space>
              <Button disabled={pagination.current! <= 1} onClick={() => fetchRequirements((pagination.current ?? 1) - 1)}>
                上一页
              </Button>
              <Typography.Text type="secondary">
                {(pagination.current ?? 1)} / {Math.ceil((pagination.total ?? 1) / (pagination.pageSize ?? 10))}
              </Typography.Text>
              <Button disabled={pagination.current! >= Math.ceil((pagination.total ?? 1) / (pagination.pageSize ?? 10))} onClick={() => fetchRequirements((pagination.current ?? 1) + 1)}>
                下一页
              </Button>
            </Space>
          </div>
        )}
      </div>
    </Space>
  );
}
