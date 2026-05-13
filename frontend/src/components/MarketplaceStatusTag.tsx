import { Tag } from 'antd';
import type {
  MarketplaceAgentStatus,
  MarketplaceTaskStatus
} from '../api/marketplace-types';
import {
  marketplaceAgentStatusColors,
  marketplaceAgentStatusLabels,
  marketplaceTaskStatusColors,
  marketplaceTaskStatusLabels
} from '../constants/options';

interface MarketplaceStatusTagProps {
  status: MarketplaceAgentStatus | MarketplaceTaskStatus;
}

export function MarketplaceStatusTag({ status }: MarketplaceStatusTagProps) {
  if (status in marketplaceTaskStatusLabels) {
    const taskStatus = status as MarketplaceTaskStatus;
    return (
      <Tag color={marketplaceTaskStatusColors[taskStatus]}>
        {marketplaceTaskStatusLabels[taskStatus]}
      </Tag>
    );
  }

  const agentStatus = status as MarketplaceAgentStatus;
  return (
    <Tag color={marketplaceAgentStatusColors[agentStatus]}>
      {marketplaceAgentStatusLabels[agentStatus]}
    </Tag>
  );
}
