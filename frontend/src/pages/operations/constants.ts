import type { CustomerStatus, MoneyValue, OrderStatus, RevenueType } from '../../api/operations';

export const customerStatusMeta: Record<CustomerStatus, { label: string; color: string }> = {
  lead: { label: '线索', color: 'gold' },
  active: { label: '活跃', color: 'green' },
  inactive: { label: '沉默', color: 'default' },
  churned: { label: '流失', color: 'red' },
};

export const orderStatusMeta: Record<OrderStatus, { label: string; color: string }> = {
  pending: { label: '待确认', color: 'default' },
  confirmed: { label: '已确认', color: 'blue' },
  in_progress: { label: '交付中', color: 'processing' },
  completed: { label: '已完成', color: 'success' },
  cancelled: { label: '已取消', color: 'error' },
};

export const revenueTypeMeta: Record<RevenueType, { label: string; color: string }> = {
  one_time: { label: '一次性', color: 'blue' },
  recurring: { label: '订阅', color: 'green' },
  refund: { label: '退款', color: 'red' },
};

export const customerStatusOptions = Object.entries(customerStatusMeta).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

export const orderStatusOptions = Object.entries(orderStatusMeta).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

export const revenueTypeOptions = Object.entries(revenueTypeMeta).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

export function moneyToNumber(value: MoneyValue | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoney(value: MoneyValue | null | undefined): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(moneyToNumber(value));
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('zh-CN');
}

export function nullWhenEmpty(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}
