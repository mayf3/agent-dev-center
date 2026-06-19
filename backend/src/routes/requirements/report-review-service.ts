import { Prisma } from '@prisma/client';
import { HttpError } from '../../utils/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { applyAdminTransitionInTx } from '../../lib/workflow-transition/index.js';
import { computeRollbackTarget, resolveReportRollbackAssignee } from './report-review-helpers.js';

export interface QaReviewInput {
  reportId: string;
  requirementId: string;
  status: 'approved' | 'rejected' | 'changes_requested';
  reviewComment?: string | null;
  reviewedAt: Date;
  qaReviewedAt: Date;
  qaReviewedBy: string;
  reviewerId: string;
  reviewerName: string;
  reviewerRole: string;
}

export interface FinalReviewInput {
  reportId: string;
  requirementId: string;
  status: 'approved' | 'rejected' | 'changes_requested';
  reviewComment?: string | null;
  reviewedAt: Date;
  reviewerId: string;
  reviewerName: string;
  reviewerRole: string;
  createRevision?: boolean;
  qaBypass?: boolean;
  qaBypassReason?: string | null;
  qaBypassAt?: Date | null;
  qaBypassBy?: string | null;
}

export type ReportReviewResult = Prisma.RequirementReportGetPayload<{}>;

interface ReportDbClient {
  requirementReport: {
    updateMany(args: Prisma.RequirementReportUpdateManyArgs): Promise<Prisma.BatchPayload>;
    findUnique(args: Prisma.RequirementReportFindUniqueArgs): Promise<Prisma.RequirementReportGetPayload<{}> | null>;
  };
}

async function reportUpdateCas(
  db: ReportDbClient,
  reportId: string,
  data: Prisma.RequirementReportUpdateManyMutationInput,
): Promise<ReportReviewResult> {
  const count = await db.requirementReport.updateMany({
    where: { id: reportId, status: 'pending' },
    data,
  });
  if (count.count === 0) throw new HttpError(409, 'concurrent report modification');

  const updated = await db.requirementReport.findUnique({ where: { id: reportId } });
  if (!updated) throw new HttpError(404, 'report not found after update');
  return updated;
}

export async function executeReportReviewQa(input: QaReviewInput): Promise<ReportReviewResult> {
  const report = await prisma.requirementReport.findUnique({
    where: { id: input.reportId },
    select: { id: true, status: true, reportType: true, requirementId: true },
  });
  if (!report) throw new HttpError(404, 'report not found');
  if (report.requirementId !== input.requirementId) throw new HttpError(400, 'report does not belong to this requirement');
  if (report.status !== 'pending') throw new HttpError(400, 'report already reviewed');

  const rollback = input.status === 'rejected' || input.status === 'changes_requested';

  if (!rollback) {
    return reportUpdateCas(prisma, input.reportId, {
      status: input.status, reviewComment: input.reviewComment,
      reviewedAt: input.reviewedAt, qaReviewedAt: input.qaReviewedAt, qaReviewedBy: input.qaReviewedBy,
    });
  }

  const reqInfo = await prisma.requirement.findUnique({
    where: { id: input.requirementId },
    select: { currentStep: true, stateVersion: true, assigneeId: true, assignee: true, workflowId: true, workflowSnapshot: true, workflow: { select: { steps: true } } },
  });
  if (!reqInfo) throw new HttpError(404, 'requirement not found');

  const actualTarget = computeRollbackTarget(report.reportType, reqInfo.currentStep, reqInfo.workflowSnapshot, reqInfo.workflow?.steps);
  if (!actualTarget || actualTarget === reqInfo.currentStep) {
    return reportUpdateCas(prisma, input.reportId, {
      status: input.status, reviewComment: input.reviewComment,
      reviewedAt: input.reviewedAt, qaReviewedAt: input.qaReviewedAt, qaReviewedBy: input.qaReviewedBy,
    });
  }

  return prisma.$transaction(async (tx) => {
    const txPrisma = tx as Prisma.TransactionClient;
    const updated = await reportUpdateCas(txPrisma, input.reportId, {
      status: input.status, reviewComment: input.reviewComment,
      reviewedAt: input.reviewedAt, qaReviewedAt: input.qaReviewedAt, qaReviewedBy: input.qaReviewedBy,
    });

    await applyAdminTransitionInTx(txPrisma, {
      requirementId: input.requirementId,
      fromStep: reqInfo.currentStep,
      toStep: actualTarget,
      expectedStateVersion: reqInfo.stateVersion,
      action: 'reject',
      actorId: input.reviewerId,
      actorName: input.reviewerName,
      actorRole: input.reviewerRole,
      comment: input.reviewComment || `${report.reportType} report rejected, rolled back to ${actualTarget}`,
      assigneeId: reqInfo.assigneeId,
      assigneeName: reqInfo.assignee,
    }, input.reviewedAt);

    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function executeReportReviewFinal(input: FinalReviewInput): Promise<ReportReviewResult> {
  const report = await prisma.requirementReport.findUnique({
    where: { id: input.reportId },
    select: { id: true, status: true, reportType: true, requirementId: true, createdAt: true },
  });
  if (!report) throw new HttpError(404, 'report not found');
  if (report.requirementId !== input.requirementId) throw new HttpError(400, 'report does not belong to this requirement');
  if (report.status !== 'pending') throw new HttpError(400, 'report already reviewed');

  const shouldRollback = input.status === 'rejected';
  const isQaBypass = !!input.qaBypass;

  if (!shouldRollback) {
    return reportUpdateCas(prisma, input.reportId, {
      status: input.status, reviewComment: input.reviewComment,
      reviewedAt: input.reviewedAt,
      ...(isQaBypass ? { qaBypass: true, qaBypassReason: input.qaBypassReason, qaBypassAt: input.qaBypassAt, qaBypassBy: input.qaBypassBy } : {}),
    });
  }

  const reqInfo = await prisma.requirement.findUnique({
    where: { id: input.requirementId },
    select: { currentStep: true, stateVersion: true, assigneeId: true, assignee: true, title: true, workflowId: true, workflowSnapshot: true, workflow: { select: { steps: true } } },
  });
  if (!reqInfo) throw new HttpError(404, 'requirement not found');

  const actualTarget = computeRollbackTarget(report.reportType, reqInfo.currentStep, reqInfo.workflowSnapshot, reqInfo.workflow?.steps);
  if (!actualTarget || actualTarget === reqInfo.currentStep) {
    return reportUpdateCas(prisma, input.reportId, {
      status: input.status, reviewComment: input.reviewComment,
      reviewedAt: input.reviewedAt,
      ...(isQaBypass ? { qaBypass: true, qaBypassReason: input.qaBypassReason, qaBypassAt: input.qaBypassAt, qaBypassBy: input.qaBypassBy } : {}),
    });
  }

  // Resolve assignee based on actualTarget (not preset target)
  const resolvedAssignee = await resolveReportRollbackAssignee(
    actualTarget, input.requirementId, reqInfo.workflowId,
    reqInfo.workflowSnapshot, reqInfo.workflow?.steps, reqInfo.assigneeId, reqInfo.assignee,
  );

  return prisma.$transaction(async (tx) => {
    const txPrisma = tx as Prisma.TransactionClient;

    const updated = await reportUpdateCas(txPrisma, input.reportId, {
      status: input.status, reviewComment: input.reviewComment,
      reviewedAt: input.reviewedAt,
      ...(isQaBypass ? { qaBypass: true, qaBypassReason: input.qaBypassReason, qaBypassAt: input.qaBypassAt, qaBypassBy: input.qaBypassBy } : {}),
    });

    await applyAdminTransitionInTx(txPrisma, {
      requirementId: input.requirementId,
      fromStep: reqInfo.currentStep,
      toStep: actualTarget,
      expectedStateVersion: reqInfo.stateVersion,
      action: 'reject',
      actorId: input.reviewerId,
      actorName: input.reviewerName,
      actorRole: input.reviewerRole,
      comment: input.reviewComment || `${report.reportType} report rejected, rolled back to ${actualTarget}`,
      assigneeId: resolvedAssignee.id,
      assigneeName: resolvedAssignee.name,
    }, input.reviewedAt);

    if (input.createRevision) {
      await txPrisma.requirementRevision.create({
        data: {
          requirementId: input.requirementId,
          title: reqInfo.title ?? '', description: '', priority: 'P2', status: 'in_progress',
          requester: '', department: '',
          assignee: resolvedAssignee.name,
          revisionNote: `${report.reportType} report rejected, step rolled back to ${actualTarget}, assignee: ${resolvedAssignee.name ?? 'none'}`,
          operatorId: input.reviewerId,
        },
      });
    }

    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
