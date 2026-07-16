import api from './client';
import type { Task, TaskStatus } from '../types';

export const listTasks = async (params?: {
  requirementId?: string;
  status?: TaskStatus;
  agentType?: string;
}): Promise<Task[]> => {
  const res = await api.get<{ data: Task[] }>('/tasks', { params });
  return res.data.data;
};

export const createTask = async (data: {
  requirementId: string;
  title: string;
  description?: string;
  agentType: string;
}): Promise<Task> => {
  const res = await api.post<Task>('/tasks', data);
  return res.data;
};

export const patchTask = async (id: string, data: { status: TaskStatus }): Promise<Task> => {
  const res = await api.patch<Task>(`/tasks/${id}`, data);
  return res.data;
};
