import { apiClient } from './client';

// ─── Types ──────────────────────────────────────────────────

export interface Identity {
  id: string;
  type: 'human' | 'agent';
  displayName: string;
  avatar?: string;
  description: string;
  longTermDirection: string;
  monthlyGoals: MonthlyGoalGroup[];
  capabilities: string[];
  pipeline?: string;
  layer?: string;
  agentId?: string;
  ownerId?: string;
  agentType?: string;
  userId?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyGoalKR {
  text: string;
  progress: number;
  status: 'todo' | 'doing' | 'done';
}

export interface MonthlyGoalGroup {
  month: string;
  goal: string;
  krs: MonthlyGoalKR[];
  status: 'active' | 'completed' | 'cancelled';
}

// ─── API Functions ──────────────────────────────────────────

export const identitiesApi = {
  list: (params?: { type?: string; search?: string; pipeline?: string; layer?: string; page?: number; pageSize?: number }) =>
    apiClient.get<{ data: Identity[]; meta: { total: number; page: number; pageSize: number; totalPages: number } }>('/api/identities', { params }),

  get: (id: string) =>
    apiClient.get<{ data: Identity }>(`/api/identities/${id}`),

  update: (id: string, data: Partial<Identity>) =>
    apiClient.patch<{ data: Identity }>(`/api/identities/${id}`, data),

  getGoals: (id: string) =>
    apiClient.get<{ data: MonthlyGoalGroup[] }>(`/api/identities/${id}/goals`),

  updateGoals: (id: string, monthlyGoals: MonthlyGoalGroup[]) =>
    apiClient.patch<{ data: MonthlyGoalGroup[] }>(`/api/identities/${id}/goals`, { monthlyGoals }),

  sync: () =>
    apiClient.post<{ message: string }>('/api/identities/sync'),
};
