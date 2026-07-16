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
import { CalendarOutlined, ReloadOutlined, UnorderedListOutlined, UserOutlined } from '@ant-design/icons';
import { App as AntApp, Badge, Button, Card, Empty, Space, Spin, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { PaginatedResponse, Requirement, RequirementStatus } from '../api/types';
import { PriorityTag } from '../components/PriorityTag';
import { StatusTag } from '../components/StatusTag';
import { useAuth } from '../contexts/AuthContext';

type BoardColumnId = 'pending' | 'clarifying' | 'in-progress' | 'testing' | 'review' | 'deploying' | 'done';

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
    id: 'clarifying',
    title: '需求澄清中',
    statuses: ['clarifying']
  },
  {
    id: 'in-progress',
    title: '开发中',
    statuses: ['approved', 'in-progress']
  },
  {
    id: 'testing',
    title: '测试中',
    statuses: ['testing']
  },
  {
    id: 'review',
    title: '待验收',
    statuses: ['review']
  },
  {
    id: 'deploying',
    title: '部署中',
    statuses: ['deploying']
  },
  {
    id: 'done',
    title: '已完成',
    statuses: ['done']
  }
];

const boardColumnIds = boardColumns.map((column) => column.id);

// WIP（Work In Progress）限制配置
const WIP_LIMITS: Record<BoardColumnId, number> = {
  pending: 0,       // 待审核无限制
  clarifying: 0,    // 澄清中无限制
  'in-progress': 8, // 开发中最多8个
  testing: 5,       // 测试中最多5个
  review: 5,        // 待验收最多5个
  deploying: 3,     // 部署中最多3个
  done: 0           // 已完成无限制
};

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
        <Space size={8} wrap>
          <Typography.Text type="secondary">
            <UserOutlined /> {requirement.assignee || '未分配'}
          </Typography.Text>
          {requirement.dueDate && (
            <Typography.Text type={dayjs(requirement.dueDate).isBefore(dayjs()) ? 'danger' : 'secondary'}>
              <CalendarOutlined /> {dayjs(requirement.dueDate).format('MM-DD')}
            </Typography.Text>
          )}
        </Space>
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
  const wipLimit = WIP_LIMITS[column.id];
  const wipExceeded = wipLimit > 0 && items.length > wipLimit;

  return (
    <section
      ref={setNodeRef}
      className={classNames('kanban-column', isOver && !dragDisabled && 'kanban-column-over')}
    >
      <div className="kanban-column-title">
        <Typography.Title level={5}>{column.title}</Typography.Title>
        <Tooltip title={wipLimit > 0 ? `WIP限制: ${wipLimit}` : '无WIP限制'}>
          <Badge
            count={items.length}
            showZero
            color={wipExceeded ? 'red' : undefined}
            overflowCount={999}
          />
        </Tooltip>
        {wipLimit > 0 && (
          <Typography.Text
            type={wipExceeded ? 'danger' : 'secondary'}
            style={{ fontSize: 11, marginLeft: 4 }}
          >
            /{wipLimit}
          </Typography.Text>
        )}
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
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRequirement, setActiveRequirement] = useState<Requirement | null>(null);
  const dragDisabled = !isAuthenticated || user?.role === 'requester';

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
        clarifying: [],
        'in-progress': [],
        testing: [],
        review: [],
        deploying: [],
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
        <Space>
          <Button icon={<UnorderedListOutlined />} onClick={() => navigate('/requirements')}>
            列表视图
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void loadRequirements()}>
            刷新
          </Button>
        </Space>
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
