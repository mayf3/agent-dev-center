import axios from 'axios';
import type { GoalCard, GoalCardResponse, MonthlyGoalGroup, UnassignedAgentsResponse } from './goals';

export type OkrStatus = 'draft' | 'proposed' | 'under_review' | 'approved' | 'active';

export interface OkrGoalCard extends GoalCard {
  okrStatus: OkrStatus;
}

export interface OkrGoalCardListResponse {
  goalCards: OkrGoalCard[];
}

export interface OkrGoalCardResponse extends Omit<GoalCardResponse, 'goalCard'> {
  goalCard: OkrGoalCard | null;
}

export interface OkrGoalStats {
  total: number;
  done: number;
  inProgress: number;
}

const okrClient = axios.create({
  baseURL: import.meta.env.VITE_OKR_API_BASE_URL ?? '/okr-api',
  timeout: 15000,
});

okrClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('agent-dev-center-token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

okrClient.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(error)
);

export function getOkrGoalStats(monthlyGoals: MonthlyGoalGroup[]): OkrGoalStats {
  let total = 0;
  let done = 0;
  let inProgress = 0;

  for (const group of monthlyGoals || []) {
    for (const goal of group.goals || []) {
      total++;
      if (goal.status === 'done') done++;
      if (goal.status === 'in_progress') inProgress++;
    }
  }

  return { total, done, inProgress };
}

export const svcOkrApi = {
  /** List enriched OKR goal cards from svc-okr. */
  list: (params?: { pipeline?: string; status?: OkrStatus }) =>
    okrClient.get<OkrGoalCardListResponse>('/api/goals', { params }),

  /** Get an enriched OKR goal card by agent id. */
  get: (agentId: string) =>
    okrClient.get<OkrGoalCardResponse>(`/api/goals/${agentId}`),

  /** Get an enriched OKR goal card by agent name. */
  getByName: (name: string) =>
    okrClient.get<OkrGoalCardResponse>(`/api/goals/by-name/${encodeURIComponent(name)}`),

  /** Get agents without OKR assignments from svc-okr. */
  getUnassigned: () =>
    okrClient.get<UnassignedAgentsResponse>('/api/goals/unassigned/list'),
};
