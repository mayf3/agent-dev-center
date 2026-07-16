/**
 * Agent 能力集市 — 主 Dashboard 页面
 *
 * 路由: /marketplace
 * Code-split: lazy loaded via React.lazy
 */
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  UserOutlined
} from '@ant-design/icons';
import {
  App as AntApp,
  Button,
  Card,
  Col,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Tabs,
  Typography
} from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listAgents,
  listTasks,
  getDashboard
} from '../../api/marketplace';
import type {
  MarketplaceAgent,
  MarketplaceTask,
  MarketplaceDashboard,
  MarketplaceTaskStatus
} from '../../api/marketplace-types';
import { useAuth } from '../../contexts/AuthContext';
import { TaskKanbanBoard } from './TaskKanbanBoard';
import { AgentCardGrid } from './AgentCardGrid';
import { TaskCreateModal } from './TaskCreateModal';
import { TaskDetailDrawer } from './TaskDetailDrawer';

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const resp = (error as { response?: { data?: { message?: string } } }).response;
    return resp?.data?.message ?? fallback;
  }
  return fallback;
}

/** 5 个状态对应 5 列看板 — 状态机完整（§4） */
export const KANBAN_COLUMNS: { key: MarketplaceTaskStatus; title: string; icon: React.ReactNode }[] = [
  { key: 'pending', title: '待领取', icon: <ClockCircleOutlined /> },
  { key: 'processing', title: '处理中', icon: <RobotOutlined spin /> },
  { key: 'completed', title: '已完成', icon: <CheckCircleOutlined /> },
  { key: 'failed', title: '失败', icon: <ExclamationCircleOutlined /> },
  { key: 'cancelled', title: '已取消', icon: <ClockCircleOutlined /> }
];

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
      pending: [], processing: [], completed: [], failed: [], cancelled: []
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

  const openDetail = (task: MarketplaceTask) => {
    setSelectedTask(task);
    setDetailOpen(true);
  };

  if (loading) return <Spin className="page-spin" />;

  return (
    <Space direction="vertical" size="large" className="page-stack">
      {/* Header — 单一操作入口（§1 元素去重） */}
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>
            <AppstoreOutlined /> Agent 能力集市
          </Typography.Title>
          <Typography.Text type="secondary">
            管理 Agent 任务、交付物和文件上传
          </Typography.Text>
        </div>
        <Space>
          <Select
            allowClear
            placeholder="按状态筛选"
            style={{ width: 140 }}
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v ?? '')}
            options={KANBAN_COLUMNS.map((c) => ({ label: c.title, value: c.key }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void loadData()}>刷新</Button>
          {isAuthenticated && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              提交任务
            </Button>
          )}
        </Space>
      </div>

      {/* Stats — 2×3 grid on mobile（§移动端） */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small"><Statistic title="待领取" value={byStatus.pending} prefix={<ClockCircleOutlined />} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small"><Statistic title="处理中" value={byStatus.processing} prefix={<RobotOutlined />} valueStyle={{ color: '#1677ff' }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small"><Statistic title="已完成" value={byStatus.completed} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small"><Statistic title="失败" value={byStatus.failed} prefix={<ExclamationCircleOutlined />} valueStyle={{ color: '#ff4d4f' }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small"><Statistic title="Agent 数" value={agents.filter((a) => a.status === 'active').length} prefix={<RobotOutlined />} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small"><Statistic title="任务总数" value={tasks.length} prefix={<UserOutlined />} /></Card>
        </Col>
      </Row>

      {/* Tabs: Kanban / Agents */}
      <Tabs
        defaultActiveKey="kanban"
        items={[
          {
            key: 'kanban',
            label: `任务看板 (${tasks.length})`,
            children: (
              <TaskKanbanBoard
                taskGroups={taskGroups}
                onTaskClick={openDetail}
              />
            )
          },
          {
            key: 'agents',
            label: `Agent 列表 (${agents.length})`,
            children: <AgentCardGrid agents={agents} />
          }
        ]}
      />

      {/* 创建任务 — 单一入口（§1） */}
      <TaskCreateModal
        open={createOpen}
        agents={agents}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => { setCreateOpen(false); void loadData(); }}
      />

      {/* 任务详情 — Drawer 侧滑（移动端友好） */}
      <TaskDetailDrawer
        task={selectedTask}
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setSelectedTask(null); }}
        onRefresh={() => void loadData()}
      />
    </Space>
  );
}
