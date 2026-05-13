export type UserRole = 'admin' | 'requester' | 'developer';
export type RequirementPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type RequirementStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'in-progress'
  | 'testing'
  | 'review'
  | 'deploying'
  | 'done';
export type TaskStatus = 'todo' | 'in-progress' | 'testing' | 'done';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AuthResponse {
  token: string;
  accessToken?: string; // 后端实际返回的字段名
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
  gitHash?: string | null;
  deployVersion?: string | null;
  createdAt: string;
  updatedAt: string;
  tasks?: Task[];
}

// ─── Service Registry ─────────────────────────────────────────────

export type ServiceStatus = 'online' | 'offline' | 'maintenance' | 'unknown';

export interface RegisteredService {
  id: string;
  name: string;
  displayName: string;
  description: string;
  port: number | null;
  localUrl: string | null;
  remoteUrl: string | null;
  techStack: string[];
  owner: string | null;
  gitRepo: string | null;
  database: string | null;
  status: ServiceStatus;
  version: string | null;
  lastDeployedAt: string | null;
  createdAt: string;
  updatedAt: string;
  requirements?: ServiceRequirementRelation[];
}

export interface ServiceRequirementRelation {
  id: string;
  serviceId: string;
  requirementId: string;
  relationType: string;
  createdAt: string;
  requirement: Requirement;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

// ─── Reports ──────────────────────────────────────────────────────

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
