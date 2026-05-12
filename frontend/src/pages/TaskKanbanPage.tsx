import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent, UniqueIdentifier } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FilterOutlined, ReloadOutlined, UserOutlined } from '@ant-design/icons';
import { App as AntApp, Badge, Button, Card, Empty, Select, Space, Spin, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Task, TaskStatus } from '../api/types';
import { taskStatusLabels, taskStatusColors } from '../constants/options';
import { useAuth } from '../contexts/AuthContext';

interface KanbanColumnConfig {
  id: TaskStatus;
  title: string;
}

const columns: KanbanColumnConfig[] = [
  { id: 'todo', title: '📋 待处理' },
  { id: 'in-progress', title: '🔧 进行中' },
  { id: 'testing', title: '🧪 测试中' },
  { id: 'done', title: '✅ 已完成' },
];

const columnIds = columns.map((c) => c.id);

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }
  return fallback;
}

function TaskCardContent({ task }: { task: Task }) {
  return (
    <>
      <Link className="kanban-card-title" to={`/requirements/${task.requirementId}`}>
        {task.title}
      </Link>
      <div className="kanban-card-meta">
        <Typography.Text type="secondary">
          <UserOutlined /> {task.agentType}
        </Typography.Text>
      </div>
    </>
  );
}

function SortableTaskCard({ task, disabled }: { task: Task; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.42 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={classNames('kanban-card-shell', disabled && 'kanban-card-disabled')}
      {...attributes}
      {...listeners}
    >
      <Card size="small" className={classNames('kanban-card', disabled && 'kanban-card-disabled')}>
        <TaskCardContent task={task} />
      </Card>
    </div>
  );
}

function KanbanColumn({
  column,
  items,
  dragDisabled,
}: {
  column: KanbanColumnConfig;
  items: Task[];
  dragDisabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      className={classNames('kanban-column', isOver && !dragDisabled && 'kanban-column-over')}
    >
      <div className="kanban-column-title">
        <Typography.Title level={5}>{column.title}</Typography.Title>
        <Badge count={items.length} showZero color={taskStatusColors[column.id]} />
      </div>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="kanban-list">
          {items.length > 0 ? (
            items.map((item) => (
              <SortableTaskCard key={item.id} task={item} disabled={dragDisabled} />
            ))
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />
          )}
        </div>
      </SortableContext>
    </section>
  );
}

export function TaskKanbanPage() {
  const { message } = AntApp.useApp();
  const { user, isAuthenticated } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>('');
  const dragDisabled = !isAuthenticated || user?.role === 'requester';

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const loadTasks = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ data: Task[] }>('/tasks', { params: { pageSize: 100 } });
      setTasks(Array.isArray(data) ? data : data.data ?? []);
    } catch (err) {
      message.error(getErrorMessage(err, '任务数据加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTasks();
  }, []);

  const agentTypes = useMemo(() => {
    const set = new Set(tasks.map((t) => t.agentType));
    return Array.from(set).sort();
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (!agentFilter) return tasks;
    return tasks.filter((t) => t.agentType === agentFilter);
  }, [tasks, agentFilter]);

  const groupedTasks = useMemo(() => {
    return columns.reduce<Record<TaskStatus, Task[]>>(
      (acc, col) => {
        acc[col.id] = filteredTasks.filter((t) => t.status === col.id);
        return acc;
      },
      { todo: [], 'in-progress': [], testing: [], done: [] }
    );
  }, [filteredTasks]);

  const getOverColumnId = (overId: UniqueIdentifier): TaskStatus | null => {
    const id = String(overId);
    if (columnIds.includes(id as TaskStatus)) {
      return id as TaskStatus;
    }
    const targetTask = tasks.find((t) => t.id === id);
    return targetTask?.status ?? null;
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    const task = tasks.find((t) => t.id === String(active.id));
    setActiveTask(task ?? null);
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveTask(null);
    if (!over || dragDisabled) return;

    const task = tasks.find((t) => t.id === String(active.id));
    const targetColumn = getOverColumnId(over.id);
    if (!task || !targetColumn || task.status === targetColumn) return;

    const prevTasks = tasks;
    setTasks((current) =>
      current.map((t) => (t.id === task.id ? { ...t, status: targetColumn } : t))
    );

    try {
      const { data } = await api.patch<{ id: string; status: TaskStatus }>(`/tasks/${task.id}`, {
        status: targetColumn,
      });
      setTasks((current) => current.map((t) => (t.id === data.id ? { ...t, status: data.status } : t)));
      message.success('任务状态已更新');
    } catch (err) {
      setTasks(prevTasks);
      message.error(getErrorMessage(err, '任务状态更新失败'));
    }
  };

  if (loading) {
    return <Spin className="page-spin" />;
  }

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>任务看板</Typography.Title>
          <Typography.Text type="secondary">
            拖动任务卡片在待处理、进行中、测试中和已完成之间流转
          </Typography.Text>
        </div>
        <Space>
          <Select
            allowClear
            placeholder="按负责人筛选"
            style={{ width: 180 }}
            value={agentFilter || undefined}
            onChange={(v) => setAgentFilter(v ?? '')}
            suffixIcon={<FilterOutlined />}
            options={agentTypes.map((a) => ({ label: a, value: a }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void loadTasks()}>
            刷新
          </Button>
        </Space>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveTask(null)}
      >
        <div className="kanban-board">
          {columns.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              items={groupedTasks[col.id]}
              dragDisabled={dragDisabled}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? (
            <Card size="small" className="kanban-card">
              <TaskCardContent task={activeTask} />
            </Card>
          ) : null}
        </DragOverlay>
      </DndContext>
    </Space>
  );
}
