import { apiClient } from './client';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  boundaries: string | null;
  featureList: string | null;
  status: string;
  ownerId: string | null;
  owner: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListResponse {
  data: Project[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export async function fetchProjects(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}): Promise<ProjectListResponse> {
  const response = await apiClient.get<ProjectListResponse>('/projects', { params });
  return response.data;
}

export async function fetchProject(id: string): Promise<Project> {
  const response = await apiClient.get<Project>(`/projects/${id}`);
  return response.data;
}
