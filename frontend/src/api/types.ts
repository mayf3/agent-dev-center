export type UserRole = 'admin' | 'requester' | 'developer';
export type RequirementPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type RequirementStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'in-progress'
  | 'testing'
  | 'review'
  | 'done';
export type TaskStatus = 'todo' | 'in-progress' | 'done';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AuthResponse {
  token: string;
  user: User;
}

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

export type ReportType = 'DEV_SELF_CHECK' | 'SECURITY_REVIEW' | 'TEST_REPORT' | 'CTO_REVIEW' | 'DEPLOY_CONFIRM';
export type ReportStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested';

export interface RequirementReport {
  id: string;
  requirementId: string;
  reportType: ReportType;
  content: Record<string, unknown>;
  submittedBy: string;
  submittedById?: string | null;
  status: ReportStatus;
  reviewComment?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
