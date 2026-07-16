/** RequirementDetailPage 共享工具函数 */

export function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }
  return fallback;
}

export function formatDateTime(value?: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }) : '未设置';
}

export function formatDate(value?: string | null): string {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '未设置';
}
