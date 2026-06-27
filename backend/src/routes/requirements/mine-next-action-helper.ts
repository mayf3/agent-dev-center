/**
 * Mine nextAction helper — compute action hints for /mine endpoint.
 *
 * Pure function, no side effects, no Prisma queries.
 * Separated from core-mine.ts to keep routing logic thin.
 */

/**
 * Conservatively determines the actor's ability to operate at the current step,
 * matching the authorization logic in workflow-advance.ts (excluding draft rules).
 *
 * Production advance permission:
 *   1. Assignee check: actor must be assignee OR cto_agent
 *   2. Role check: mapUserRole OR cto_agent
 */
export function canOperateStep(params: {
  actorId: string;
  actorRole: string;
  actorInternalRole: string | null | undefined;
  stepRole: string;
  assigneeId: string | null;
  mapUserRole: (internalRole: string | null | undefined, stepRole: string) => string | null;
}): boolean {
  const { actorId, actorRole, actorInternalRole, stepRole, assigneeId, mapUserRole } = params;

  // cto_agent bypasses ALL checks (matched production advance)
  if (actorRole === 'cto_agent') return true;

  // Must be the assignee (or requirement has no assignee)
  if (assigneeId && assigneeId !== actorId) return false;

  // Role must match (or cto_agent which is already checked above)
  const roleMatch = mapUserRole(actorInternalRole, stepRole);
  if (!roleMatch) return false;

  return true;
}

/**
 * Next action codes for /mine endpoint.
 *
 * RATIONALE:
 * - No ADVANCE_CURRENT_STEP: requiredReports only covers partial gates;
 *   testing/security/qa_review may have real business actions even when
 *   requiredReports is empty or full approved.
 * - No producer inference via step-name matching: no authoritative mapping
 *   exists (REPORT_ROLE_MAP in reports.ts is about submission permission,
 *   not step-to-report-type mapping).
 */
export type NextActionCode =
  | 'SUBMIT_REQUIRED_REPORT'
  | 'REVIEW_REQUIRED_REPORT'
  | 'RECONCILE_CURRENT_STEP'
  | 'WAIT_FOR_REPORT'
  | 'FIX_ASSIGNMENT'
  | 'NONE';

export type NextActionResult = {
  code: NextActionCode;
  text: string;
};

/**
 * Compute next action for a requirement item at /mine.
 *
 * Authoritative report submission permission:
 *   REPORT_ROLE_MAP (reports.ts) mode=assignee means the requirement assignee
 *   can submit. For /mine, the actor IS the assignee (filtered by assigneeId).
 *   However, without an authoritative step→report mapping, we cannot determine
 *   WHICH step a report should be produced at. Therefore, for missing reports
 *   without an existing record, we conservatively use RECONCILE/WAIT rather
 *   than claiming SUBMIT.
 */
export function computeNextAction(params: {
  currentStepName: string;
  requiredReports: string[];
  reportRecords: Array<{ reportType: string; status: string }>;
  stepRole: string;
  actorCanOperate: boolean;
  actorId: string;
  actorRole: string;
  stepAssigneeId: string | null;
}): NextActionResult {
  const { requiredReports, reportRecords, stepRole, actorCanOperate, actorId, stepAssigneeId } = params;

  // ── Assignment / role mismatch checks ──
  const isAssignee = !stepAssigneeId || stepAssigneeId === actorId;

  // Neither assignee nor cto_agent → can't operate at all
  if (!isAssignee && !actorCanOperate) {
    return { code: 'NONE', text: stepRole ? `等待 ${stepRole} 角色处理` : '等待步骤处理' };
  }

  // Is assignee but role doesn't match (not cto_agent) → assignment problem
  if (isAssignee && !actorCanOperate) {
    return { code: 'FIX_ASSIGNMENT', text: `你是当前负责人但角色不匹配，需要 ${stepRole} 角色处理，请联系管理员调整分配` };
  }

  // cto_agent bypass or assignee + role match — can proceed

  if (requiredReports.length === 0) {
    return { code: 'RECONCILE_CURRENT_STEP', text: '重新读取当前步骤状态并按步骤职责执行；本提示未确认所有 workflow gate' };
  }

  // Check each required report
  //
  // REPORT_STEP_GENERATION_UNSCOPED:
  //   There is no authoritative "workflow step → report producer" mapping in the
  //   current data model. REPORT_ROLE_MAP (reports.ts) defines who MAY submit a
  //   report type, not WHICH step produces it. Without that mapping we cannot
  //   authoritatively tell whether the actor should produce the report, or wait
  //   for someone else. Therefore missing reports always become RECONCILE.
  for (const rt of requiredReports) {
    const records = reportRecords.filter(r => r.reportType === rt);

    if (records.length === 0) {
      // Report doesn't exist yet — we cannot determine who should produce it.
      return {
        code: 'RECONCILE_CURRENT_STEP',
        text: `当前步骤尚无 ${rt}；请按当前步骤职责执行并重新检查。本提示未确认报告生产责任或全部 workflow gate，不代表应等待他人或可以直接推进`,
      };
    }

    const pendingRecord = records.find(r => r.status === 'pending');
    if (pendingRecord) {
      // A pending report exists. If actor can operate (assignee+role or cto_agent),
      // they are a candidate reviewer → REVIEW. Otherwise → explicit wait for a
      // legitimate reviewer.
      if (actorCanOperate) {
        return { code: 'REVIEW_REQUIRED_REPORT', text: `审查并批准/拒绝 ${rt}；完成后重新读取 Requirement 并检查下一动作` };
      }
      return { code: 'WAIT_FOR_REPORT', text: `等待有权限的审查角色处理 ${rt}` };
    }
  }

  // All required reports have been handled (approved/rejected/changes_requested).
  // Still can't claim advance — other gates may apply.
  return { code: 'RECONCILE_CURRENT_STEP', text: '重新读取当前步骤状态并按步骤职责执行；本提示未确认所有 workflow gate' };
}
