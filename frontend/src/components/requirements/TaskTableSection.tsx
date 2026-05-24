/**
 * 任务表格区域 — 需求详情页内的任务列表+进度条
 * 从 RequirementDetailPage 拆出 (代码结构合规)
 */
import { PlusOutlined, ScissorOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Card, Progress, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useState } from 'react';
import { api } from '../../api/client';
import type { Task, TaskStatus } from '../../api/types';
import { TaskStatusTag } from '../StatusTag';
import { taskStatusLabels } from '../../constants/options';
import { getErrorMessage } from './utils';

interface TaskTableSectionProps {
  requirementId: string;
  tasks: Task[];
  canManage: boolean;
  onRefresh: () => Promise<void>;
  onCreateTask: () => void;
}

export function TaskTableSection({ requirementId, tasks, canManage, onRefresh, onCreateTask }: TaskTableSectionProps) {
  const { message } = AntApp.useApp();
  const [taskUpdating, setTaskUpdating] = useState<string | null>(null);
  const [decomposeLoading, setDecomposeLoading] = useState(false);
  const [decomposePreview, setDecomposePreview] = useState<Array<{ title: string; description: string; agentType: string }> | null>(null);
  const [decomposeModalOpen, setDecomposeModalOpen] = useState(false);

  const taskOptions = (Object.keys(taskStatusLabels) as TaskStatus[]).map((status) => ({
    value: status,
    label: taskStatusLabels[status]
  }));

  const handleTaskStatusChange = useCallback(async (task: Task, status: TaskStatus) => {
    setTaskUpdating(task.id);
    try {
      await api.patch<Task>(`/tasks/${task.id}`, { status });
      message.success('任务状态已更新');
      await onRefresh();
    } catch (error) {
      message.error(getErrorMessage(error, '任务状态更新失败'));
    } finally {
      setTaskUpdating(null);
    }
  }, [message, onRefresh]);

  const handleDecompose = useCallback(async () => {
    setDecomposeLoading(true);
    try {
      const res = await api.post(`/api/requirements/${requirementId}/decompose`, {});
      setDecomposePreview(res.data.decomposedTasks);
      setDecomposeModalOpen(true);
    } catch (err: any) {
      message.error(err?.response?.data?.message || '拆解失败');
    } finally {
      setDecomposeLoading(false);
    }
  }, [requirementId, message]);

  const handleDecomposeConfirm = useCallback(async () => {
    setDecomposeLoading(true);
    try {
      await api.post(`/api/requirements/${requirementId}/decompose`, { confirm: true });
      message.success('拆解完成，子任务已创建');
      setDecomposeModalOpen(false);
      setDecomposePreview(null);
      await onRefresh();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '拆解失败');
    } finally {
      setDecomposeLoading(false);
    }
  }, [requirementId, message, onRefresh]);

  const taskColumns: ColumnsType<Task> = [
    {
      title: '任务',
      dataIndex: 'title',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{record.title}</Typography.Text>
          <Typography.Text type="secondary" ellipsis>{record.description}</Typography.Text>
        </Space>
      )
    },
    { title: '开发 Agent', dataIndex: 'agentType', width: 180 },
    {
      title: '状态', dataIndex: 'status', width: 120,
      render: (status: TaskStatus) => <TaskStatusTag status={status} />
    },
    {
      title: '更新时间', dataIndex: 'updatedAt', width: 170,
      render: (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    },
    ...(canManage ? [{
      title: '操作', key: 'action', width: 160,
      render: (_: unknown, record: Task) => (
        <Select
          value={record.status}
          options={taskOptions}
          loading={taskUpdating === record.id}
          disabled={Boolean(taskUpdating)}
          style={{ width: 130 }}
          onChange={(status: TaskStatus) => void handleTaskStatusChange(record, status)}
        />
      )
    }] : [])
  ];

  const doneCount = tasks.filter(t => t.status === 'done').length;
  const inProgressCount = tasks.filter(t => t.status === 'in-progress').length;
  const progressPercent = Math.round((doneCount / Math.max(tasks.length, 1)) * 100);

  return (
    <Card
      title="相关任务"
      extra={canManage && (
        <Space>
          {tasks.length === 0 && (
            <Button size="small" icon={<ScissorOutlined />} onClick={handleDecompose} loading={decomposeLoading}>
              自动拆解
            </Button>
          )}
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={onCreateTask}>
            创建任务
          </Button>
        </Space>
      )}
    >
      {tasks.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Space style={{ width: '100%' }} direction="vertical" size={4}>
            <Space split={<Typography.Text type="secondary">|</Typography.Text>}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                总计 <strong>{tasks.length}</strong> 个任务
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                完成 <strong>{doneCount}</strong>
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                进行中 <strong>{inProgressCount}</strong>
              </Typography.Text>
            </Space>
            <Progress percent={progressPercent} size="small" strokeColor="#1677ff" />
          </Space>
        </div>
      )}
      <Table rowKey="id" columns={taskColumns} dataSource={tasks} pagination={false} scroll={{ x: 760 }} />
    </Card>
  );
}
