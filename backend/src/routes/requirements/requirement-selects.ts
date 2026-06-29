/**
 * Requirement Query Selects — field-level projections and shared filter logic.
 *
 * Summary is projected at the Prisma query level (select, not post-hoc strip)
 * to avoid reading large fields like description, notes, workflowSnapshot.
 *
 * A second-layer response projector (toRequirementSummary) guarantees that
 * even if the mock or a future code change returns extra fields, the HTTP
 * response body never leaks them.
 */
import { Prisma } from '@prisma/client';

// ── Summary Prisma select ─────────────────────────────────────

/**
 * Prisma select for summary view — only lightweight metadata fields.
 *
 * Must NOT include:
 *   description, notes, attachment, workflowSnapshot,
 *   gitHash, branch, repoPath, deployVersion, rejectReason,
 *   dependsOnIds, blockedBy, stateVersion, dueDate,
 *   pmApprovedAt, pmApprovedBy
 */
export const REQUIREMENT_SUMMARY_SELECT = {
  id: true,
  title: true,
  currentStep: true,
  status: true,
  priority: true,
  assignee: true,
  assigneeId: true,
  requester: true,
  requesterId: true,
  type: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RequirementSelect;

/** The exact key set that a summary response item MUST contain. */
export const REQUIREMENT_SUMMARY_KEYS = Object.freeze([
  'id', 'title', 'currentStep', 'status', 'priority',
  'assignee', 'assigneeId', 'requester', 'requesterId',
  'type', 'createdAt', 'updatedAt',
]);

/**
 * Second-layer summary projector.
 * Guarantees that ONLY the frozen fields appear in the HTTP response.
 */
export function toRequirementSummary(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id ?? null,
    title: row.title ?? null,
    currentStep: row.currentStep ?? null,
    status: row.status ?? null,
    priority: row.priority ?? null,
    assignee: row.assignee ?? null,
    assigneeId: row.assigneeId ?? null,
    requester: row.requester ?? null,
    requesterId: row.requesterId ?? null,
    type: row.type ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

// ── Shared list filter builder ────────────────────────────────

/**
 * Build the "AND" conditions from validated list query parameters.
 *
 * This is the pure filter portion (identity-agnostic).
 * Each caller wraps it with their own identity condition.
 *
 * identity-agnostic means: no roleAwareRequirementWhere, no requesterId condition.
 */
export function buildRequirementListFilters(query: {
  currentStep?: string;
  status?: string;
  priority?: string;
  type?: string;
  tags?: string[];
  search?: string;
  assigneeId?: string;
  projectId?: string;
}): Prisma.RequirementWhereInput[] {
  const filters: Prisma.RequirementWhereInput[] = [];

  if (query.currentStep) {
    filters.push({ currentStep: query.currentStep });
  } else if (query.status) {
    filters.push({ currentStep: query.status });
  }
  if (query.priority) {
    filters.push({ priority: query.priority as any });
  }
  if (query.type) {
    filters.push({ type: query.type as any });
  }
  if (query.tags && query.tags.length > 0) {
    filters.push({ tags: { hasEvery: query.tags } });
  }
  if (query.search) {
    filters.push({
      OR: [
        { title: { contains: query.search, mode: 'insensitive' as const } },
        { description: { contains: query.search, mode: 'insensitive' as const } },
        { requester: { contains: query.search, mode: 'insensitive' as const } },
        { department: { contains: query.search, mode: 'insensitive' as const } },
        { assignee: { contains: query.search, mode: 'insensitive' as const } },
      ],
    });
  }
  if (query.assigneeId) {
    filters.push({ assigneeId: query.assigneeId });
  }
  if (query.projectId) {
    filters.push({ projectId: query.projectId });
  }

  return filters;
}
