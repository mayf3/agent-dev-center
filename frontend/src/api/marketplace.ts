import { api } from './client';
import type {
  DeliverableType,
  MarketplaceAgent,
  MarketplaceAgentStatus,
  MarketplaceDashboard,
  MarketplaceDeliverable,
  MarketplacePriority,
  MarketplaceTask,
  MarketplaceTaskStatus
} from './marketplace-types';

interface ApiData<T> {
  data: T;
}

export interface MarketplacePagination {
  page: number;
  limit: number;
  total: number;
}

export interface MarketplaceListResponse<T> {
  data: T[];
  pagination: MarketplacePagination;
}

export interface ListMarketplaceAgentsParams {
  status?: MarketplaceAgentStatus;
}

export interface ListMarketplaceTasksParams {
  agentId?: string;
  status?: MarketplaceTaskStatus;
  page?: number;
  limit?: number;
}

export interface CreateMarketplaceTaskInput {
  agentName: string;
  title: string;
  description: string;
  input?: unknown;
  priority?: MarketplacePriority;
  deadline?: string;
}

export interface UpdateMarketplaceTaskInput {
  status?: MarketplaceTaskStatus;
  startedAt?: string;
  completedAt?: string;
  errorMsg?: string;
}

export interface CreateMarketplaceDeliverableInput {
  type: DeliverableType;
  title?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MarketplaceUploadResult {
  filename: string;
  originalName: string;
  url: string;
  size: number;
  mimeType: string;
  extension?: string;
}

export async function listAgents(params?: ListMarketplaceAgentsParams) {
  const { data } = await api.get<ApiData<MarketplaceAgent[]>>('/marketplace/agents', {
    params
  });
  return data.data;
}

export async function getAgent(id: string) {
  const { data } = await api.get<ApiData<MarketplaceAgent>>(`/marketplace/agents/${id}`);
  return data.data;
}

export async function listTasks(params?: ListMarketplaceTasksParams) {
  const { data } = await api.get<MarketplaceListResponse<MarketplaceTask>>('/marketplace/tasks', {
    params
  });
  return data;
}

export async function getTask(id: string) {
  const { data } = await api.get<ApiData<MarketplaceTask>>(`/marketplace/tasks/${id}`);
  return data.data;
}

export async function createTask(input: CreateMarketplaceTaskInput) {
  const { data } = await api.post<ApiData<MarketplaceTask>>('/marketplace/tasks', input);
  return data.data;
}

export async function claimTask(agentName: string, taskId?: string) {
  const { data } = await api.post<ApiData<MarketplaceTask>>('/marketplace/tasks/claim', {
    agentName,
    taskId
  });
  return data.data;
}

export async function updateTask(id: string, input: UpdateMarketplaceTaskInput) {
  const { data } = await api.patch<ApiData<MarketplaceTask>>(`/marketplace/tasks/${id}`, input);
  return data.data;
}

export async function listDeliverables(taskId: string) {
  const { data } = await api.get<ApiData<MarketplaceDeliverable[]>>(
    `/marketplace/deliverables/task/${taskId}`
  );
  return data.data;
}

export async function createDeliverable(
  taskId: string,
  input: CreateMarketplaceDeliverableInput
) {
  const { data } = await api.post<ApiData<MarketplaceDeliverable>>(
    `/marketplace/deliverables/task/${taskId}`,
    input
  );
  return data.data;
}

export async function deleteDeliverable(id: string) {
  const { data } = await api.delete<{ success: boolean; id: string }>(
    `/marketplace/deliverables/${id}`
  );
  return data;
}

export async function uploadFile(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  const { data } = await api.post<ApiData<MarketplaceUploadResult>>(
    '/marketplace/uploads',
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' }
    }
  );
  return data.data;
}

export async function deleteFile(filename: string) {
  const { data } = await api.delete<{ success: boolean; filename: string }>(
    `/marketplace/uploads/${encodeURIComponent(filename)}`
  );
  return data;
}

export async function getDashboard() {
  const { data } = await api.get<ApiData<MarketplaceDashboard>>('/marketplace/tasks/dashboard');
  return data.data;
}

export const marketplaceApi = {
  listAgents,
  getAgent,
  listTasks,
  getTask,
  createTask,
  claimTask,
  updateTask,
  listDeliverables,
  createDeliverable,
  deleteDeliverable,
  uploadFile,
  deleteFile,
  getDashboard
};
