import api from './client';
import type {
  Requirement,
  PaginatedResponse,
  DashboardStats,
  RequirementStatus,
  RequirementPriority,
} from '../types';
import { PAGE_SIZE } from '../constants';

export interface DemandFilters {
  page?: number;
  pageSize?: number;
  status?: RequirementStatus;
  priority?: RequirementPriority;
  search?: string;
}

export const list = async (filters?: DemandFilters): Promise<PaginatedResponse<Requirement>> => {
  const params: Record<string, any> = {
    page: filters?.page ?? 1,
    pageSize: filters?.pageSize ?? PAGE_SIZE,
  };
  if (filters?.status) params.status = filters.status;
  if (filters?.priority) params.priority = filters.priority;
  if (filters?.search) params.search = filters.search;
  const res = await api.get<PaginatedResponse<Requirement>>('/requirements', { params });
  return res.data;
};

export const getById = async (id: string): Promise<Requirement> => {
  const res = await api.get<Requirement>(`/requirements/${id}`);
  return res.data;
};

export const create = async (data: {
  title: string;
  description: string;
  priority: RequirementPriority;
  department: string;
  assignee?: string;
  dueDate?: string;
  attachment?: string;
}): Promise<Requirement> => {
  const res = await api.post<Requirement>('/requirements', data);
  return res.data;
};

export const update = async (id: string, data: {
  title?: string;
  description?: string;
  priority?: RequirementPriority;
  department?: string;
  assignee?: string;
  dueDate?: string;
  attachment?: string;
}): Promise<Requirement> => {
  const res = await api.put<Requirement>(`/requirements/${id}`, data);
  return res.data;
};

export const patchStatus = async (id: string, data: {
  status?: RequirementStatus;
  assignee?: string;
  rejectReason?: string;
}): Promise<Requirement> => {
  const res = await api.patch<Requirement>(`/requirements/${id}`, data);
  return res.data;
};

export const getStats = async (): Promise<DashboardStats> => {
  const res = await api.get<PaginatedResponse<Requirement>>('/requirements', {
    params: { page: 1, pageSize: 1 },
  });
  const total = res.data.meta.total;
  // 分状态统计需要额外过滤
  const [pending, active, testing, done] = await Promise.all([
    list({ status: 'pending', pageSize: 1 }),
    list({ status: 'approved', pageSize: 1 }),
    list({ status: 'testing', pageSize: 1 }),
    list({ status: 'done', pageSize: 1 }),
  ]);
  return {
    totalDemands: total,
    pendingCount: pending.meta.total,
    activeCount: active.meta.total + (await list({ status: 'in-progress', pageSize: 1 })).meta.total,
    testingCount: testing.meta.total + (await list({ status: 'review', pageSize: 1 })).meta.total,
    doneCount: done.meta.total,
  };
};

export const getRecent = async (limit: number = 5): Promise<Requirement[]> => {
  const res = await list({ page: 1, pageSize: limit });
  return res.data;
};
