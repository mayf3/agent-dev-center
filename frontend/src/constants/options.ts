import type {
  MarketplaceAgentStatus,
  MarketplacePriority,
  MarketplaceTaskStatus
} from '../api/marketplace-types';
import type { ReportStatus, ReportType, RequirementPriority, RequirementStatus, TaskStatus, UserRole } from '../api/types';

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
  clarifying: '需求澄清中',
  approved: '待开发',
  rejected: '已拒绝',
  'in-progress': '开发中',
  testing: '测试中',
  review: '待验收',
  deploying: '部署中',
  done: '已完成'
};

export const statusColors: Record<RequirementStatus, string> = {
  pending: 'default',
  clarifying: 'gold',
  approved: 'processing',
  rejected: 'error',
  'in-progress': 'blue',
  testing: 'purple',
  review: 'cyan',
  deploying: 'orange',
  done: 'success'
};

export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: '待处理',
  'in-progress': '进行中',
  testing: '测试中',
  done: '已完成'
};

export const taskStatusColors: Record<TaskStatus, string> = {
  todo: 'default',
  'in-progress': 'processing',
  testing: 'purple',
  done: 'success',
};

export const marketplaceAgentStatusLabels: Record<MarketplaceAgentStatus, string> = {
  active: '在线',
  inactive: '停用',
  maintenance: '维护中'
};

export const marketplaceAgentStatusColors: Record<MarketplaceAgentStatus, string> = {
  active: 'success',
  inactive: 'default',
  maintenance: 'warning'
};

export const marketplaceTaskStatusLabels: Record<MarketplaceTaskStatus, string> = {
  pending: '待领取',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
};

export const marketplaceTaskStatusColors: Record<MarketplaceTaskStatus, string> = {
  pending: 'default',
  processing: 'processing',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning'
};

export const marketplacePriorityLabels: Record<MarketplacePriority, string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急'
};

export const marketplacePriorityColors: Record<MarketplacePriority, string> = {
  low: 'green',
  normal: 'blue',
  high: 'gold',
  urgent: 'red'
};

export const agentOptions = [
  'game-dev-agent',
  'mobile-app-engineer',
  'miniapp-game-engineer',
  'agent-dev-engineer',
  'devtools-agent',
  'frontend-react-engineer',
  'itops-agent',
  'test-engineer',
  'security-agent'
];

export const departmentOptions = ['平台产品', '游戏业务', '移动应用', '小程序', '增长运营', '内部效率'];

export const reportTypeLabels: Record<ReportType, string> = {
  DEV_SELF_CHECK: '开发自检',
  SECURITY_REVIEW: '安全检查',
  TEST_REPORT: '测试报告',
  CTO_REVIEW: 'CTO 验收',
  DEPLOY_CONFIRM: '发布确认',
  POSTMORTEM: '验尸报告',
};

export const reportStatusLabels: Record<ReportStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  changes_requested: '需修改',
};

export const reportStatusColors: Record<ReportStatus, string> = {
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
  changes_requested: 'blue',
};

export const reportTypeOrder: ReportType[] = [
  'POSTMORTEM',
  'DEV_SELF_CHECK',
  'SECURITY_REVIEW',
  'TEST_REPORT',
  'CTO_REVIEW',
  'DEPLOY_CONFIRM',
];
