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

/** QA 审查 findings — 替换 LLM 二元判断为确定性决策 */
export interface Finding {
  severity: 'critical' | 'minor';
  category: 'code_ref_missing' | 'curl_mismatch' | 'coverage_gap' | 'build_fail' | 'logic_error' | 'format_issue' | 'other';
  description: string;
}

/** QA 审查类型常量 */
export const FINDING_SEVERITY_LABELS: Record<Finding['severity'], string> = {
  critical: '严重',
  minor: '轻微',
};

export const FINDING_CATEGORY_LABELS: Record<Finding['category'], string> = {
  code_ref_missing: '缺少代码引用',
  curl_mismatch: 'CURL 验证不符',
  coverage_gap: '覆盖不足',
  build_fail: '编译失败',
  logic_error: '逻辑错误',
  format_issue: '格式问题',
  other: '其他',
};

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
