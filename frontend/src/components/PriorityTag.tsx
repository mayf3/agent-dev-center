import { Tag } from 'antd';
import type { RequirementPriority } from '../api/types';
import { priorityColors, priorityLabels } from '../constants/options';

interface PriorityTagProps {
  priority: RequirementPriority;
}

export function PriorityTag({ priority }: PriorityTagProps) {
  return <Tag color={priorityColors[priority]}>{priorityLabels[priority]}</Tag>;
}
