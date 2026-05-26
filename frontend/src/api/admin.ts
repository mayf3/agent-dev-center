import { apiClient } from './client';
import type { AdminUser, InternalRole, OkrRole, PaginatedResponse, UserRole } from './types';

export const adminApi = {
  fetchUsers: (page: number, pageSize: number, search?: string) =>
    apiClient.get<PaginatedResponse<AdminUser>>('/admin/users', {
      params: { page, pageSize, ...(search ? { search } : {}) },
    }),

  updateUserRoles: (
    id: string,
    data: { role?: UserRole; okrRole?: OkrRole; internalRole?: InternalRole | null }
  ) => apiClient.patch<AdminUser>(`/admin/users/${id}`, data),

  resetUserPassword: (id: string) =>
    apiClient.post<{ generatedPassword: string }>(`/admin/users/${id}/reset-password`),
};
