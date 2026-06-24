import { Tag } from 'antd';
import type { MarketplacePriority } from '../api/marketplace-types';
import {
  marketplacePriorityColors,
  marketplacePriorityLabels
} from '../constants/options';

interface MarketplacePriorityTagProps {
  priority: MarketplacePriority;
}

export function MarketplacePriorityTag({ priority }: MarketplacePriorityTagProps) {
  return <Tag color={marketplacePriorityColors[priority]}>{marketplacePriorityLabels[priority]}</Tag>;
}
