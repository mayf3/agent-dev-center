export type UserRole = 'admin' | 'requester' | 'developer' | 'agent' | 'cto_agent';
export type OkrRole = 'okr_admin' | 'okr_reviewer' | 'okr_member' | 'okr_owner';
export type InternalRole = 'cto' | 'pm' | 'developer' | 'tester' | 'security' | 'ops' | 'qa';
export type RequirementPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type RequirementType = 'FEATURE' | 'BUGFIX' | 'POSTMORTEM' | 'INFRA' | 'SECURITY';
export type RequirementStatus =
  | 'pending'
  | 'clarifying'
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
  internalRole?: InternalRole | null;
  okrRole?: OkrRole | null;
  mustChangePassword?: boolean;
  createdAt?: string;
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

export interface Attachment {
  filename: string;
  originalName: string;
  url: string;
  size: number;
  mimeType: string;
  uploadedAt?: string;
}

export interface RequirementProject {
  id: string;
  name: string;
  boundaries: string | null;
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  notes?: string;
  priority: RequirementPriority;
  status: RequirementStatus;
  type?: RequirementType;
  tags?: string[];
  requester: string;
  department: string;
  assignee?: string | null;
  dueDate?: string | null;
  attachment?: string | null;
  rejectReason?: string | null;
  gitHash?: string | null;
  deployVersion?: string | null;
  projectId?: string | null;
  project?: RequirementProject | null;
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

export type ReportType = 'DEV_SELF_CHECK' | 'SECURITY_REVIEW' | 'TEST_REPORT' | 'CTO_REVIEW' | 'DEPLOY_CONFIRM' | 'POSTMORTEM';
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
  qaReviewedBy?: string | null;
  qaReviewedAt?: string | null;
  qaFindings?: QAReviewFinding[] | null;
  qaBypass?: boolean;
  qaBypassReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QAReviewFinding {
  severity: 'critical' | 'minor';
  category: FindingCategory;
  description: string;
}

export type FindingCategory =
  | 'code_ref_missing'
  | 'curl_mismatch'
  | 'coverage_gap'
  | 'build_fail'
  | 'logic_error'
  | 'format_issue'
  | 'other';

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  internalRole: InternalRole | null;
  okrRole: OkrRole;
  mustChangePassword: boolean;
  createdAt: string;
}
