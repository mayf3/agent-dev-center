import Constants from 'expo-constants';
import type { RequirementStatus, RequirementPriority, TaskStatus } from '../types';

export const API_BASE_URL = (Constants.expoConfig?.extra as any)?.apiBaseUrl ?? 'http://8.163.44.127/api';

export const STORAGE_KEYS = {
  AUTH_TOKEN: 'agent-dev-center-token',
  USER_DATA: 'agent-dev-center-user',
} as const;

export const STATUS_CONFIG: Record<RequirementStatus, { label: string; color: string; bgColor: string }> = {
  pending:      { label: '待审核',    color: '#F59E0B', bgColor: '#FEF3C7' },
  approved:     { label: '待开发',    color: '#3B82F6', bgColor: '#DBEAFE' },
  'in-progress': { label: '开发中',   color: '#8B5CF6', bgColor: '#EDE9FE' },
  testing:      { label: '测试中',    color: '#EC4899', bgColor: '#FCE7F3' },
  review:       { label: '待验收',    color: '#06B6D4', bgColor: '#CFFAFE' },
  done:         { label: '已完成',    color: '#10B981', bgColor: '#D1FAE5' },
  rejected:     { label: '已拒绝',    color: '#EF4444', bgColor: '#FEE2E2' },
};

export const PRIORITY_CONFIG: Record<RequirementPriority, { label: string; color: string; bgColor: string }> = {
  P0: { label: '紧急', color: '#EF4444', bgColor: '#FEE2E2' },
  P1: { label: '高',   color: '#F97316', bgColor: '#FFF7ED' },
  P2: { label: '中',   color: '#3B82F6', bgColor: '#DBEAFE' },
  P3: { label: '低',   color: '#6B7280', bgColor: '#F3F4F6' },
};

export const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; bgColor: string }> = {
  todo:        { label: '待处理', color: '#9CA3AF', bgColor: '#F3F4F6' },
  'in-progress': { label: '进行中', color: '#8B5CF6', bgColor: '#EDE9FE' },
  testing:     { label: '测试中', color: '#EC4899', bgColor: '#FCE7F3' },
  done:        { label: '已完成', color: '#10B981', bgColor: '#D1FAE5' },
};

export const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  requester: '需求提交人',
  developer: '开发人员',
};

export const COLORS = {
  primary: '#1677FF',
  primaryLight: '#4096FF',
  primaryDark: '#0958D9',
  background: '#F5F7FB',
  surface: '#FFFFFF',
  text: 'rgba(0,0,0,0.88)',
  textSecondary: '#666',
  textTertiary: '#999',
  border: '#E8E8E8',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
};

export const PAGE_SIZE = 20;
