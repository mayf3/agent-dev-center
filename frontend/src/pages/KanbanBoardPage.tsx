import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent, UniqueIdentifier } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ReloadOutlined, UserOutlined } from '@ant-design/icons';
import { App as AntApp, Badge, Button, Card, Empty, Space, Spin, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PaginatedResponse, Requirement, RequirementStatus } from '../api/types';
import { PriorityTag } from '../components/PriorityTag';
import { StatusTag } from '../components/StatusTag';
import { useAuth } from '../contexts/AuthContext';

type BoardColumnId = 'pending' | 'in-progress' | 'testing' | 'done';

interface BoardColumnConfig {
  id: BoardColumnId;
  title: string;
  statuses: RequirementStatus[];
}

const boardColumns: BoardColumnConfig[] = [
  {
    id: 'pending',
    title: '待审核',
    statuses: ['pending', 'rejected']
  },
  {
    id: 'in-progress',
    title: '开发中',
    statuses: ['approved', 'in-progress']
  },
  {
    id: 'testing',
    title: '测试中',
    statuses: ['testing', 'review']
  },
  {
    id: 'done',
    title: '已完成',
    statuses: ['done']
  }
];

const boardColumnIds = boardColumns.map((column) => column.id);

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function getColumnId(status: RequirementStatus): BoardColumnId {
  return boardColumns.find((column) => column.statuses.includes(status))?.id ?? 'pending';
}

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }

  return fallback;
}

function RequirementCardContent({ requirement }: { requirement: Requirement }) {
  return (
    <>
      <Link className="kanban-card-title" to={`/requirements/${requirement.id}`}>
        {requirement.title}
      </Link>
      <Space size={[4, 8]} wrap>
        <PriorityTag priority={requirement.priority} />
        <StatusTag status={requirement.status} />
      </Space>
      <div className="kanban-card-meta">
        <Typography.Text type="secondary">
          <UserOutlined /> {requirement.assignee || '未分配'}
        </Typography.Text>
      </div>
    </>
  );
}

function SortableRequirementCard({
  requirement,
  disabled
}: {
  requirement: Requirement;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: requirement.id,
    disabled
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.42 : 1
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
        <RequirementCardContent requirement={requirement} />
      </Card>
    </div>
  );
}

function KanbanColumn({
  column,
  items,
  dragDisabled
}: {
  column: BoardColumnConfig;
  items: Requirement[];
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
        <Badge count={items.length} showZero />
      </div>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="kanban-list">
          {items.length > 0 ? (
            items.map((item) => (
              <SortableRequirementCard key={item.id} requirement={item} disabled={dragDisabled} />
            ))
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无需求" />
          )}
        </div>
      </SortableContext>
    </section>
  );
}

export function KanbanBoardPage() {
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRequirement, setActiveRequirement] = useState<Requirement | null>(null);
  const dragDisabled = user?.role === 'requester';

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  const loadRequirements = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<PaginatedResponse<Requirement>>('/requirements', {
        params: { page: 1, pageSize: 100 }
      });
      setRequirements(data.data);
    } catch (error) {
      message.error(getErrorMessage(error, '看板数据加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRequirements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupedRequirements = useMemo(() => {
    return boardColumns.reduce<Record<BoardColumnId, Requirement[]>>(
      (accumulator, column) => {
        accumulator[column.id] = requirements.filter((item) =>
          column.statuses.includes(item.status)
        );
        return accumulator;
      },
      {
        pending: [],
        'in-progress': [],
        testing: [],
        done: []
      }
    );
  }, [requirements]);

  const getOverColumnId = (overId: UniqueIdentifier): BoardColumnId | null => {
    const id = String(overId);
    if (boardColumnIds.includes(id as BoardColumnId)) {
      return id as BoardColumnId;
    }

    const targetRequirement = requirements.find((item) => item.id === id);
    return targetRequirement ? getColumnId(targetRequirement.status) : null;
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    const requirement = requirements.find((item) => item.id === String(active.id));
    setActiveRequirement(requirement ?? null);
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveRequirement(null);
    if (!over || dragDisabled) {
      return;
    }

    const requirement = requirements.find((item) => item.id === String(active.id));
    const targetColumn = getOverColumnId(over.id);
    if (!requirement || !targetColumn) {
      return;
    }

    const currentColumn = getColumnId(requirement.status);
    if (currentColumn === targetColumn) {
      return;
    }

    const previousRequirements = requirements;
    setRequirements((current) =>
      current.map((item) => (item.id === requirement.id ? { ...item, status: targetColumn } : item))
    );

    try {
      const { data } = await api.patch<Requirement>(`/requirements/${requirement.id}`, {
        status: targetColumn
      });
      setRequirements((current) => current.map((item) => (item.id === data.id ? data : item)));
      message.success('需求状态已更新');
    } catch (error) {
      setRequirements(previousRequirements);
      message.error(getErrorMessage(error, '需求状态更新失败'));
    }
  };

  if (loading) {
    return <Spin className="page-spin" />;
  }

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>开发看板</Typography.Title>
          <Typography.Text type="secondary">
            拖动需求卡片在待审核、开发、测试和完成阶段之间流转
          </Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void loadRequirements()}>
          刷新
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveRequirement(null)}
      >
        <div className="kanban-board">
          {boardColumns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              items={groupedRequirements[column.id]}
              dragDisabled={dragDisabled}
            />
          ))}
        </div>
        <DragOverlay>
          {activeRequirement ? (
            <Card size="small" className="kanban-card">
              <RequirementCardContent requirement={activeRequirement} />
            </Card>
          ) : null}
        </DragOverlay>
      </DndContext>
    </Space>
  );
}
