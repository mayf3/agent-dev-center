import type { RequirementPriority, RequirementStatus, TaskStatus, UserRole } from '../api/types';

export const roleLabels: Record<UserRole, string> = {
  admin: 'CTO',
  requester: '需求提交者',
  developer: '开发Agent'
};

export const priorityLabels: Record<RequirementPriority, string> = {
  P0: 'P0 紧急',
  P1: 'P1 高',
  P2: 'P2 中',
  P3: 'P3 低'
};

export const priorityColors: Record<RequirementPriority, string> = {
  P0: 'red',
  P1: 'volcano',
  P2: 'gold',
  P3: 'green'
};

export const statusLabels: Record<RequirementStatus, string> = {
  pending: '待审核',
  approved: '待开发',
  rejected: '已拒绝',
  'in-progress': '开发中',
  testing: '测试中',
  review: '待验收',
  done: '已完成'
};

export const statusColors: Record<RequirementStatus, string> = {
  pending: 'default',
  approved: 'processing',
  rejected: 'error',
  'in-progress': 'blue',
  testing: 'purple',
  review: 'cyan',
  done: 'success'
};

export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: '待处理',
  'in-progress': '进行中',
  done: '已完成'
};

export const agentOptions = [
  'game-dev-agent',
  'mobile-app-engineer',
  'miniapp-game-engineer',
  'backend-engineer',
  'frontend-engineer'
];

export const departmentOptions = ['平台产品', '游戏业务', '移动应用', '小程序', '增长运营', '内部效率'];
