export type MarketplaceAgentStatus = 'active' | 'inactive' | 'maintenance';
export type MarketplaceTaskStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type MarketplacePriority = 'low' | 'normal' | 'high' | 'urgent';
export type DeliverableType = 'text' | 'image' | 'document' | 'url' | 'file';

export interface MarketplaceAgent {
  id: string;
  name: string;
  displayName: string;
  description: string;
  avatar?: string;
  capabilities: unknown[];
  apiEndpoint?: string;
  status: MarketplaceAgentStatus;
  createdAt: string;
  updatedAt: string;
  _count?: { tasks: number };
}

export interface MarketplaceTask {
  id: string;
  agentId: string;
  agent: MarketplaceAgent;
  requesterId: string;
  requesterName: string;
  title: string;
  description: string;
  input?: unknown;
  status: MarketplaceTaskStatus;
  priority: MarketplacePriority;
  deadline?: string;
  startedAt?: string;
  completedAt?: string;
  errorMsg?: string;
  deliverables?: MarketplaceDeliverable[];
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceDeliverable {
  id: string;
  taskId: string;
  type: DeliverableType;
  title?: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceDashboard {
  byStatus: Record<MarketplaceTaskStatus, number>;
  topAgents: MarketplaceAgent[];
  recentTasks: MarketplaceTask[];
}
