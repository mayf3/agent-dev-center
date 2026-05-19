import { apiClient } from './client';

export type PostmortemStatus = 'pending' | 'implemented' | 'verified';

export interface Postmortem {
  id: string;
  requirementId: string | null;
  requirement: {
    id: string;
    title: string;
    priority: string;
    status: string;
    description?: string;
  } | null;
  title: string;
  phenomenon: string;
  rootCause: string;
  whyExistingProcess: string;
  longTermPrinciple: string;
  preventionMeasures: string;
  responsiblePerson: string;
  status: PostmortemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PostmortemListResponse {
  postmortems: Postmortem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PostmortemCreatePayload {
  requirementId?: string;
  title: string;
  phenomenon: string;
  rootCause: string;
  whyExistingProcess?: string;
  longTermPrinciple?: string;
  preventionMeasures: string;
  responsiblePerson: string;
}

export interface PostmortemUpdatePayload {
  title?: string;
  phenomenon?: string;
  rootCause?: string;
  whyExistingProcess?: string;
  longTermPrinciple?: string;
  preventionMeasures?: string;
  responsiblePerson?: string;
  status?: PostmortemStatus;
}

export interface PostmortemStats {
  thisMonth: number;
  total: number;
  overdue: number;
  byStatus: { status: string; count: number }[];
}

export interface PostmortemsByRequirementResponse {
  postmortems: Postmortem[];
}

export const postmortemsApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<PostmortemListResponse>('/api/postmortems', { params }),

  get: (id: string) =>
    apiClient.get<{ postmortem: Postmortem }>(`/api/postmortems/${id}`),

  create: (data: PostmortemCreatePayload) =>
    apiClient.post<{ postmortem: Postmortem }>('/api/postmortems', data),

  update: (id: string, data: PostmortemUpdatePayload) =>
    apiClient.patch<{ postmortem: Postmortem }>(`/api/postmortems/${id}`, data),

  delete: (id: string) =>
    apiClient.delete(`/api/postmortems/${id}`),

  getStats: () =>
    apiClient.get<PostmortemStats>('/api/postmortems/stats/summary'),

  getByRequirement: (requirementId: string) =>
    apiClient.get<PostmortemsByRequirementResponse>(`/api/postmortems/by-requirement/${requirementId}`),
};
