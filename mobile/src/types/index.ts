// 用户角色（与后端一致）
export type UserRole = 'admin' | 'requester' | 'developer';

// 需求状态（与后端一致）
export type RequirementStatus =
  | 'pending' | 'approved' | 'rejected' | 'in-progress' | 'testing' | 'review' | 'done';

// 需求优先级
export type RequirementPriority = 'P0' | 'P1' | 'P2' | 'P3';

// 任务状态
export type TaskStatus = 'todo' | 'in-progress' | 'testing' | 'done';

// 用户
export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

// 认证响应
export interface AuthResponse {
  token: string;
  user: User;
}

// 需求
export interface Requirement {
  id: string;
  title: string;
  description: string;
  priority: RequirementPriority;
  status: RequirementStatus;
  requester: string;
  department: string;
  assignee?: string | null;
  dueDate?: string | null;
  attachment?: string | null;
  rejectReason?: string | null;
  createdAt: string;
  updatedAt: string;
  tasks?: Task[];
}

// 任务
export interface Task {
  id: string;
  requirementId: string;
  title: string;
  description: string;
  agentType: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

// 分页响应
export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

// API 错误
export interface ApiError {
  message: string;
  statusCode: number;
}

// 仪表盘统计
export interface DashboardStats {
  totalDemands: number;
  pendingCount: number;
  activeCount: number;
  testingCount: number;
  doneCount: number;
}

// 登录请求
export interface LoginRequest {
  email: string;
  password: string;
}

// 注册请求
export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}
