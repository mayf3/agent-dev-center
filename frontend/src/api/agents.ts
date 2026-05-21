import { apiClient } from './client';

// ─── Types ──────────────────────────────────────────────────

export interface AgentGoalCardSummary {
  id: string;
  pipeline: string;
  longTermDirection: string;
  monthlyGoals: { month: string; goals: Array<{ text: string; status: string }> }[];
  selfCheckCriteria: string;
  pushedMonths: string[];
  status: string;
  lastReviewedAt: string | null;
  lastReviewedBy: string | null;
  upstreamAgentIds: string[];
  downstreamAgentIds: string[];
  stats: {
    total: number;
    done: number;
    inProgress: number;
  };
}

export interface AgentListItem {
  id: string;
  name: string;
  displayName: string;
  description: string;
  avatar: string | null;
  capabilities: unknown;
  apiEndpoint: string | null;
  status: string;
  tags: string[];
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
  goalCard: AgentGoalCardSummary | null;
}

export interface AgentDetail extends AgentListItem {
  notificationType: string;
  feishuWebhookUrl: string | null;
  taskStats: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  goalCard: (AgentGoalCardSummary & {
    revisions: Array<{
      id: string;
      longTermDirection: string;
      monthlyGoals: unknown;
      selfCheckCriteria: string;
      pipeline: string;
      changeNote: string;
      changedBy: string;
      createdAt: string;
    }>;
  }) | null;
}

export interface AgentListResponse {
  data: AgentListItem[];
}

export interface AgentDetailResponse {
  data: AgentDetail;
}

export interface LayersResponse {
  data: string[];
}

export interface WeeklyReportPayload {
  week: string;
  content: string;
  summary: string;
  nextWeekPlan: string;
  blockers: string;
}

export interface WeeklyReportResponse {
  data: {
    id: string;
    agentId: string;
    week: string;
    summary: string;
    content: string;
    nextWeekPlan: string;
    blockers: string;
    submittedBy: string;
    createdAt: string;
  };
}

// ─── API Functions ──────────────────────────────────────────

export const agentsApi = {
  /** 列出所有 Agent（含目标卡） */
  list: (params?: { layer?: string; pipeline?: string; search?: string }) =>
    apiClient.get<AgentListResponse>('/api/agents', { params }),

  /** 获取单个 Agent 详情 */
  get: (agentId: string) =>
    apiClient.get<AgentDetailResponse>(`/api/agents/${agentId}`),

  /** 获取层列表 */
  getLayers: () =>
    apiClient.get<LayersResponse>('/api/agents/layers/list'),

  /** 更新 Agent 标签 */
  updateTags: (agentId: string, tags: string[]) =>
    apiClient.patch<{ data: unknown }>(`/api/agents/${agentId}`, { tags }),

  /** 提交周报 */
  submitWeeklyReport: (agentId: string, payload: WeeklyReportPayload) =>
    apiClient.post<WeeklyReportResponse>(`/api/agents/${agentId}/weekly-reports`, payload),

  /** 获取周报列表 */
  getWeeklyReports: (agentId: string) =>
    apiClient.get<{ data: WeeklyReportResponse['data'][] }>(`/api/agents/${agentId}/weekly-reports`),
};
