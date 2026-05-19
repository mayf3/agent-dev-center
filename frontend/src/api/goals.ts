import { apiClient } from './client';

// ─── Types ──────────────────────────────────────────────────

export interface MonthlyGoal {
  text: string;
  status: 'not_started' | 'in_progress' | 'done';
}

export interface MonthlyGoalGroup {
  month: string;
  goals: MonthlyGoal[];
}

export interface GoalCard {
  id: string;
  agentId: string;
  agent: {
    id: string;
    name: string;
    displayName: string;
    avatar?: string;
  };
  pipeline: string;
  upstreamAgentIds: string[];
  downstreamAgentIds: string[];
  longTermDirection: string;
  monthlyGoals: MonthlyGoalGroup[];
  selfCheckCriteria: string;
  pushedMonths: string[];
  status: 'active' | 'paused' | 'archived';
  lastReviewedAt: string | null;
  lastReviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
  revisions?: GoalRevision[];
}

export interface GoalRevision {
  id: string;
  goalCardId: string;
  longTermDirection: string;
  monthlyGoals: MonthlyGoalGroup[];
  selfCheckCriteria: string;
  pipeline: string;
  changeNote: string;
  changedBy: string;
  changedById: string | null;
  createdAt: string;
}

export interface GoalCardListResponse {
  goalCards: GoalCard[];
}

export interface GoalCardResponse {
  goalCard: GoalCard | null;
}

export interface UnassignedAgentsResponse {
  agents: {
    id: string;
    name: string;
    displayName: string;
    avatar?: string;
    capabilities: unknown;
  }[];
}

export interface PushTodosResponse {
  created: number;
  taskIds: string[];
  total: number;
}

export interface GoalRevisionsResponse {
  revisions: GoalRevision[];
}

export interface CreateGoalCardPayload {
  agentId: string;
  pipeline: string;
  longTermDirection: string;
  monthlyGoals?: MonthlyGoalGroup[];
  selfCheckCriteria?: string;
  upstreamAgentIds?: string[];
  downstreamAgentIds?: string[];
}

export interface UpdateGoalCardPayload {
  pipeline?: string;
  longTermDirection?: string;
  monthlyGoals?: MonthlyGoalGroup[];
  selfCheckCriteria?: string;
  upstreamAgentIds?: string[];
  downstreamAgentIds?: string[];
  status?: string;
  changeNote?: string;
}

// ─── API Functions ──────────────────────────────────────────

export const goalsApi = {
  /** Agent 读取自己的目标卡 */
  getMine: () =>
    apiClient.get<GoalCardResponse>('/api/goals/mine'),

  /** 列出所有目标卡 */
  list: (params?: { pipeline?: string; status?: string }) =>
    apiClient.get<GoalCardListResponse>('/api/goals', { params }),

  /** 获取单个目标卡 */
  get: (agentId: string) =>
    apiClient.get<GoalCardResponse>(`/api/goals/${agentId}`),

  /** 获取未规划 Agent */
  getUnassigned: () =>
    apiClient.get<UnassignedAgentsResponse>('/api/goals/unassigned/list'),

  /** 创建目标卡 */
  create: (data: CreateGoalCardPayload) =>
    apiClient.post<GoalCardResponse>('/api/goals', data),

  /** 更新目标卡 */
  update: (agentId: string, data: UpdateGoalCardPayload) =>
    apiClient.put<GoalCardResponse>(`/api/goals/${agentId}`, data),

  /** 更新月度目标状态 */
  updateGoalStatus: (agentId: string, month: string, goalIndex: number, status: MonthlyGoal['status']) =>
    apiClient.patch<GoalCardResponse>(`/api/goals/${agentId}/monthly-goals/${month}/${goalIndex}`, { status }),

  /** 推送月度目标到 LLM Todo */
  pushTodos: (agentId: string, month: string) =>
    apiClient.post<PushTodosResponse>(`/api/goals/${agentId}/push-todos`, { month }),

  /** 获取变更历史 */
  getRevisions: (agentId: string) =>
    apiClient.get<GoalRevisionsResponse>(`/api/goals/${agentId}/revisions`),
};
