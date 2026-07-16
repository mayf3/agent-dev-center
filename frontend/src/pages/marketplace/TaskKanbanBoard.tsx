/**
 * 任务看板 — 5列状态完整（pending/processing/completed/failed/cancelled）
 * 移动端自动堆叠为纵向列表
 */
import { Badge, Card, Empty, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { UserOutlined } from '@ant-design/icons';
import type { MarketplaceTask, MarketplaceTaskStatus } from '../../api/marketplace-types';
import { MarketplaceStatusTag } from '../../components/MarketplaceStatusTag';
import { MarketplacePriorityTag } from '../../components/MarketplacePriorityTag';
import { KANBAN_COLUMNS } from './MarketplacePage';

interface TaskKanbanBoardProps {
  taskGroups: Record<string, MarketplaceTask[]>;
  onTaskClick: (task: MarketplaceTask) => void;
}

export function TaskKanbanBoard({ taskGroups, onTaskClick }: TaskKanbanBoardProps) {
  return (
    <div className="kanban-board">
      {KANBAN_COLUMNS.map((col) => {
        const tasks = taskGroups[col.key] ?? [];
        return (
          <section key={col.key} className="kanban-column">
            <div className="kanban-column-title">
              <Space>
                {col.icon}
                <Typography.Text strong>{col.title}</Typography.Text>
              </Space>
              <Badge count={tasks.length} showZero
                style={{ backgroundColor: col.key === 'completed' ? '#52c41a' : col.key === 'failed' ? '#ff4d4f' : undefined }}
              />
            </div>
            <div className="kanban-list">
              {tasks.length > 0 ? (
                tasks.map((task) => (
                  <Card
                    key={task.id}
                    size="small"
                    className="kanban-card"
                    hoverable
                    onClick={() => onTaskClick(task)}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>{task.title}</div>
                    <Space size={[4, 4]} wrap>
                      <MarketplacePriorityTag priority={task.priority} />
                      <Tag>{task.agent?.displayName ?? task.agentId}</Tag>
                    </Space>
                    <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 6 }}>
                      <UserOutlined /> {task.requesterName} · {dayjs(task.createdAt).format('MM-DD HH:mm')}
                    </div>
                  </Card>
                ))
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
