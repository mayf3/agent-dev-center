import { Tag } from 'antd';
import type { RequirementStatus, TaskStatus } from '../api/types';
import { statusColors, statusLabels, taskStatusLabels } from '../constants/options';

interface StatusTagProps {
  status: RequirementStatus;
}

interface TaskStatusTagProps {
  status: TaskStatus;
}

export function StatusTag({ status }: StatusTagProps) {
  return <Tag color={statusColors[status]}>{statusLabels[status]}</Tag>;
}

export function TaskStatusTag({ status }: TaskStatusTagProps) {
  const color = status === 'done' ? 'success' : status === 'in-progress' ? 'blue' : 'default';
  return <Tag color={color}>{taskStatusLabels[status]}</Tag>;
}
