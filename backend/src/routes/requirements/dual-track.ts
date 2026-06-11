/**
 * Dual-Track Review & Acceptance Routes
 *
 * 双轨审查验收机制：
 * - 效率管家（efficiency_manager）负责微观审查验收
 * - 龙虾合伙人（lobster_partner）负责宏观审查验收
 * - 两方各自独立提交 verdict，双方都通过后才推进工作流
 */
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { notifyEvent } from '../../utils/notifications.js';
import { resolveAssigneeForStep, getAssigneeName } from '../../lib/assignee-resolver.js';

// ── Zod Schemas ────────────────────────────────────────────────

const reviewVerdictSchema = z.object({
  body: z.object({
    role: z.enum(['efficiency_manager', 'lobster_partner']),
    verdict: z.enum(['approved', 'rejected']),
    comment: z.string().trim().max(2000).optional(),
  }),
});

const acceptanceVerdictSchema = z.object({
  body: z.object({
    role: z.enum(['efficiency_manager', 'lobster_partner']),
    verdict: z.enum(['approved', 'rejected']),
    comment: z.string().trim().max(2000).optional(),
  }),
});

// ── Types ──────────────────────────────────────────────────────

interface WorkflowStep {
  name: string;
  displayName: string;
  role: string;
  requiredReports: string[];
  autoAdvance: boolean;
}

// ── Helpers ────────────────────────────────────────────────────

/** Parse steps from JSONB */
function parseSteps(stepsJson: unknown): WorkflowStep[] {
  const steps = z.array(z.object({
    name: z.string(),
    displayName: z.string(),
    role: z.string(),
    requiredReports: z.array(z.string()),
    autoAdvance: z.boolean().default(false),
  })).parse(stepsJson);
  return steps;
}

/** Get next step (or null if at end) */
function getNextStep(steps: WorkflowStep[], currentStepName: string): WorkflowStep | null {
  const idx = steps.findIndex(s => s.name === currentStepName);
  if (idx === -1 || idx >= steps.length - 1) return null;
  return steps[idx + 1];
}

/** Write audit transition log */
async function logTransition(params: {
  requirementId: string;
  fromStep: string;
  toStep: string;
  action: string;
  actorId: string | undefined;
  actorName: string;
  actorRole: string;
  comment?: string;
  metadata?: any;
}) {
  return prisma.workflowTransition.create({
    data: {
      requirementId: params.requirementId,
      fromStep: params.fromStep,
      toStep: params.toStep,
      action: params.action,
      actorId: params.actorId,
      actorName: params.actorName,
      actorRole: params.actorRole,
      comment: params.comment,
      metadata: params.metadata ?? undefined,
    },
  });
}

/** Map user internalRole to role name (for permission check in this module) */
function mapUserRole(internalRole: string | null | undefined, role: string): string | null {
  if (!internalRole) return null;
  const mapping: Record<string, string[]> = {
    cto: ['cto', 'admin'],
    admin: ['cto', 'admin'],
    efficiency_manager: ['efficiency_manager'],
    lobster_partner: ['lobster_partner'],
  };
  const allowed = mapping[internalRole] || [];
  return allowed.includes(role) ? role : null;
}

// ── Route Registration ─────────────────────────────────────────

export function registerDualTrackRoutes(router: import('express').Router): void {

  /**
   * POST /:id/dual-track/review
   * Submit a review verdict (efficiency_manager or lobster_partner)
   * If both reviewers have submitted and both approved → advance to dev_self_check
   * If either rejected → set to review_rejected
   */
  router.post(
    '/:id/dual-track/review',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const { body } = reviewVerdictSchema.parse({ body: req.body });

      // Fetch requirement
      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        include: { workflow: true },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');
      if (!requirement.workflow) throw new HttpError(400, '该需求未分配工作流');

      // Check current step is a review step
      const currentStep = requirement.currentStep;
      const validReviewSteps = ['review_efficiency', 'review_lobster'];
      if (!currentStep || !validReviewSteps.includes(currentStep)) {
        throw new HttpError(400, `当前步骤「${currentStep}」不允许提交审查意见，需要在 review_efficiency 或 review_lobster 步骤`);
      }

      // Role check: user must have the internal role they're claiming
      const matchedRole = mapUserRole(req.user!.internalRole, body.role);
      if (!matchedRole && req.user!.role !== 'admin' && req.user!.role !== 'cto_agent') {
        throw new HttpError(403, `提交审查意见需要「${body.role}」角色，你的角色是「${req.user!.internalRole ?? req.user!.role}」`);
      }

      // Get current verdicts
      const verdicts: Record<string, string | null> =
        typeof requirement.reviewVerdicts === 'object' && requirement.reviewVerdicts !== null
          ? requirement.reviewVerdicts as Record<string, string | null>
          : { efficiency_manager: null, lobster_partner: null };

      // Check if already submitted
      if (verdicts[body.role] !== null) {
        throw new HttpError(409, `${body.role === 'efficiency_manager' ? '效率管家' : '龙虾合伙人'}已提交过审查意见，不能重复提交`);
      }

      // Update verdict
      verdicts[body.role] = body.verdict;

      // Create a RequirementComment recording the verdict
      await prisma.requirementComment.create({
        data: {
          requirementId: params.id,
          type: 'review',
          content: body.comment
            ? `【${body.role === 'efficiency_manager' ? '效率管家' : '龙虾合伙人'}】审查${body.verdict === 'approved' ? '通过' : '驳回'}: ${body.comment}`
            : `【${body.role === 'efficiency_manager' ? '效率管家' : '龙虾合伙人'}】审查${body.verdict === 'approved' ? '通过' : '驳回'}`,
          authorId: req.user!.id,
          mentions: [],
        },
      });

      // Check if both reviewers have submitted
      const bothSubmitted = verdicts.efficiency_manager !== null && verdicts.lobster_partner !== null;

      if (bothSubmitted) {
        // Both submitted - check if both approved
        if (verdicts.efficiency_manager === 'approved' && verdicts.lobster_partner === 'approved') {
          // Both approved → advance past review steps to dev_self_check
          const steps = parseSteps(requirement.workflow.steps);
          const stepsAfterReview = ['review_efficiency', 'review_lobster'];
          let targetStepIndex = -1;
          for (let i = 0; i < steps.length; i++) {
            if (!stepsAfterReview.includes(steps[i].name)) {
              targetStepIndex = i;
              break;
            }
          }

          const targetStep = targetStepIndex >= 0 ? steps[targetStepIndex] : null;
          if (!targetStep) throw new HttpError(500, '工作流配置错误：找不到审查后的步骤');

          // Resolve assignee for the target step
          const newAssigneeId = await resolveAssigneeForStep(targetStep.role, requirement.assigneeId);
          const newAssigneeName = await getAssigneeName(newAssigneeId);

          await prisma.requirement.update({
            where: { id: params.id },
            data: {
              reviewVerdicts: verdicts as any,
              reviewReviewedAt: new Date(),
              currentStep: targetStep.name,
              assigneeId: newAssigneeId,
            },
          });

          await logTransition({
            requirementId: params.id,
            fromStep: currentStep,
            toStep: targetStep.name,
            action: 'advance',
            actorId: req.user!.id,
            actorName: req.user!.name,
            actorRole: req.user!.internalRole ?? req.user!.role,
            comment: '双轨审查通过，推进到下一步',
            metadata: { verdicts, reviewType: 'dual-track' },
          });

          await notifyEvent('requirement.status_changed' as any, {
            id: params.id,
            title: requirement.title,
            status: targetStep.name,
          } as any);

          return res.json({
            success: true,
            message: '双方审查已通过，需求已推进',
            data: {
              verdicts,
              bothReviewersApproved: true,
              toStep: targetStep.name,
              toStepDisplayName: targetStep.displayName,
              newAssigneeId,
              newAssigneeName,
            },
          });
        } else {
          // Either rejected → set to review_rejected
          const rejectedBy = verdicts.efficiency_manager === 'rejected' ? '效率管家' : '龙虾合伙人';
          const rejectedBoth = verdicts.efficiency_manager === 'rejected' && verdicts.lobster_partner === 'rejected';

          await prisma.requirement.update({
            where: { id: params.id },
            data: {
              reviewVerdicts: verdicts as any,
              reviewReviewedAt: new Date(),
              currentStep: 'review_rejected',
            },
          });

          await logTransition({
            requirementId: params.id,
            fromStep: currentStep,
            toStep: 'review_rejected',
            action: 'reject',
            actorId: req.user!.id,
            actorName: req.user!.name,
            actorRole: req.user!.internalRole ?? req.user!.role,
            comment: `审查驳回: ${rejectedBoth ? '双方均驳回' : `${rejectedBy}驳回`}`,
            metadata: { verdicts, reviewType: 'dual-track' },
          });

          await notifyEvent('requirement.status_changed' as any, {
            id: params.id,
            title: requirement.title,
            status: 'review_rejected',
          } as any);

          return res.json({
            success: true,
            message: '审查未通过，需求已标记为审查驳回',
            data: {
              verdicts,
              bothReviewersApproved: false,
              rejectedBy,
              status: 'review_rejected',
            },
          });
        }
      } else {
        // Waiting for the other reviewer
        await prisma.requirement.update({
          where: { id: params.id },
          data: { reviewVerdicts: verdicts as any },
        });

        const waitingFor = body.role === 'efficiency_manager' ? 'lobster_partner' : 'efficiency_manager';
        const waitingName = waitingFor === 'efficiency_manager' ? '效率管家' : '龙虾合伙人';

        return res.json({
          success: true,
          message: `${body.role === 'efficiency_manager' ? '效率管家' : '龙虾合伙人'}审查意见已提交，等待${waitingName}审查`,
          data: {
            verdicts,
            waitingFor,
            bothSubmitted: false,
          },
        });
      }
    }),
  );

  /**
   * POST /:id/dual-track/acceptance
   * Submit an acceptance verdict (efficiency_manager or lobster_partner)
   * If both reviewers have submitted and both approved → advance to cto_review
   * If either rejected → set to acceptance_rejected
   */
  router.post(
    '/:id/dual-track/acceptance',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const { body } = acceptanceVerdictSchema.parse({ body: req.body });

      // Fetch requirement
      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        include: { workflow: true },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');
      if (!requirement.workflow) throw new HttpError(400, '该需求未分配工作流');

      // Check current step is an acceptance step
      const currentStep = requirement.currentStep;
      const validAcceptanceSteps = ['acceptance_efficiency', 'acceptance_lobster'];
      if (!currentStep || !validAcceptanceSteps.includes(currentStep)) {
        throw new HttpError(400, `当前步骤「${currentStep}」不允许提交验收意见，需要在 acceptance_efficiency 或 acceptance_lobster 步骤`);
      }

      // Role check
      const matchedRole = mapUserRole(req.user!.internalRole, body.role);
      if (!matchedRole && req.user!.role !== 'admin' && req.user!.role !== 'cto_agent') {
        throw new HttpError(403, `提交验收意见需要「${body.role}」角色，你的角色是「${req.user!.internalRole ?? req.user!.role}」`);
      }

      // Get current verdicts
      const verdicts: Record<string, string | null> =
        typeof requirement.acceptanceVerdicts === 'object' && requirement.acceptanceVerdicts !== null
          ? requirement.acceptanceVerdicts as Record<string, string | null>
          : { efficiency_manager: null, lobster_partner: null };

      // Check if already submitted
      if (verdicts[body.role] !== null) {
        throw new HttpError(409, `${body.role === 'efficiency_manager' ? '效率管家' : '龙虾合伙人'}已提交过验收意见，不能重复提交`);
      }

      // Update verdict
      verdicts[body.role] = body.verdict;

      // Create a RequirementComment recording the verdict
      await prisma.requirementComment.create({
        data: {
          requirementId: params.id,
          type: 'review',
          content: body.comment
            ? `【${body.role === 'efficiency_manager' ? '效率管家' : '龙虾合伙人'}】验收${body.verdict === 'approved' ? '通过' : '驳回'}: ${body.comment}`
            : `【${body.role === 'efficiency_manager' ? '效率管家' : '龙虾合伙人'}】验收${body.verdict === 'approved' ? '通过' : '驳回'}`,
          authorId: req.user!.id,
          mentions: [],
        },
      });

      // Check if both reviewers have submitted
      const bothSubmitted = verdicts.efficiency_manager !== null && verdicts.lobster_partner !== null;

      if (bothSubmitted) {
        // Both submitted - check if both approved
        if (verdicts.efficiency_manager === 'approved' && verdicts.lobster_partner === 'approved') {
          // Both approved → advance past acceptance steps to cto_review
          const steps = parseSteps(requirement.workflow.steps);
          const stepsAfterAcceptance = ['acceptance_efficiency', 'acceptance_lobster'];
          let targetStepIndex = -1;
          for (let i = 0; i < steps.length; i++) {
            if (!stepsAfterAcceptance.includes(steps[i].name)) {
              targetStepIndex = i;
              break;
            }
          }

          const targetStep = targetStepIndex >= 0 ? steps[targetStepIndex] : null;
          if (!targetStep) throw new HttpError(500, '工作流配置错误：找不到验收后的步骤');

          // Resolve assignee for the target step
          const newAssigneeId = await resolveAssigneeForStep(targetStep.role, requirement.assigneeId);
          const newAssigneeName = await getAssigneeName(newAssigneeId);

          await prisma.requirement.update({
            where: { id: params.id },
            data: {
              acceptanceVerdicts: verdicts as any,
              acceptanceReviewedAt: new Date(),
              currentStep: targetStep.name,
              assigneeId: newAssigneeId,
            },
          });

          await logTransition({
            requirementId: params.id,
            fromStep: currentStep,
            toStep: targetStep.name,
            action: 'advance',
            actorId: req.user!.id,
            actorName: req.user!.name,
            actorRole: req.user!.internalRole ?? req.user!.role,
            comment: '双轨验收通过，推进到下一步',
            metadata: { verdicts, acceptanceType: 'dual-track' },
          });

          return res.json({
            success: true,
            message: '双方验收已通过，需求已推进',
            data: {
              verdicts,
              bothReviewersApproved: true,
              toStep: targetStep.name,
              toStepDisplayName: targetStep.displayName,
              newAssigneeId,
              newAssigneeName,
            },
          });
        } else {
          // Either rejected → set to acceptance_rejected
          const rejectedBy = verdicts.efficiency_manager === 'rejected' ? '效率管家' : '龙虾合伙人';
          const rejectedBoth = verdicts.efficiency_manager === 'rejected' && verdicts.lobster_partner === 'rejected';

          await prisma.requirement.update({
            where: { id: params.id },
            data: {
              acceptanceVerdicts: verdicts as any,
              acceptanceReviewedAt: new Date(),
              currentStep: 'acceptance_rejected',
            },
          });

          await logTransition({
            requirementId: params.id,
            fromStep: currentStep,
            toStep: 'acceptance_rejected',
            action: 'reject',
            actorId: req.user!.id,
            actorName: req.user!.name,
            actorRole: req.user!.internalRole ?? req.user!.role,
            comment: `验收驳回: ${rejectedBoth ? '双方均驳回' : `${rejectedBy}驳回`}`,
            metadata: { verdicts, acceptanceType: 'dual-track' },
          });

          return res.json({
            success: true,
            message: '验收未通过，需求已标记为验收驳回',
            data: {
              verdicts,
              bothReviewersApproved: false,
              rejectedBy,
              status: 'acceptance_rejected',
            },
          });
        }
      } else {
        // Waiting for the other reviewer
        await prisma.requirement.update({
          where: { id: params.id },
          data: { acceptanceVerdicts: verdicts as any },
        });

        const waitingFor = body.role === 'efficiency_manager' ? 'lobster_partner' : 'efficiency_manager';
        const waitingName = waitingFor === 'efficiency_manager' ? '效率管家' : '龙虾合伙人';

        return res.json({
          success: true,
          message: `${body.role === 'efficiency_manager' ? '效率管家' : '龙虾合伙人'}验收意见已提交，等待${waitingName}验收`,
          data: {
            verdicts,
            waitingFor,
            bothSubmitted: false,
          },
        });
      }
    }),
  );

  /**
   * GET /:id/dual-track/verdicts
   * Get current review and acceptance verdicts with comments
   */
  router.get(
    '/:id/dual-track/verdicts',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });

      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          reviewVerdicts: true,
          acceptanceVerdicts: true,
          reviewReviewedAt: true,
          acceptanceReviewedAt: true,
          currentStep: true,
        },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');

      // Get related review comments
      const reviewComments = await prisma.requirementComment.findMany({
        where: {
          requirementId: params.id,
          type: 'review',
        },
        include: {
          author: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      res.json({
        success: true,
        data: {
          currentStep: requirement.currentStep,
          reviewVerdicts: requirement.reviewVerdicts,
          acceptanceVerdicts: requirement.acceptanceVerdicts,
          reviewReviewedAt: requirement.reviewReviewedAt,
          acceptanceReviewedAt: requirement.acceptanceReviewedAt,
          reviewComments: reviewComments.map(c => ({
            id: c.id,
            content: c.content,
            authorId: c.authorId,
            authorName: c.author.name,
            createdAt: c.createdAt,
          })),
        },
      });
    }),
  );

  /**
   * POST /:id/dual-track/resubmit
   * Agent resubmits after review_rejected → resets verdicts and goes back to review steps
   */
  router.post(
    '/:id/dual-track/resubmit',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });

      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        include: { workflow: true },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');
      if (!requirement.workflow) throw new HttpError(400, '该需求未分配工作流');

      // Only allow from review_rejected state
      if (requirement.currentStep !== 'review_rejected') {
        throw new HttpError(400, `当前步骤「${requirement.currentStep}」不是审查驳回状态，无法重新提交`);
      }

      // Check that user is the assignee or admin
      const isAssignee = requirement.assigneeId === req.user!.id;
      const isAdmin = req.user!.role === 'admin' || req.user!.role === 'cto_agent';
      if (!isAssignee && !isAdmin) {
        throw new HttpError(403, '只有需求负责人或管理员可以重新提交');
      }

      // Get steps
      const steps = parseSteps(requirement.workflow.steps);
      // Find the first review step
      const firstReviewStep = steps.find(s => s.name === 'review_efficiency' || s.name === 'review_lobster');
      const targetStep = firstReviewStep ?? steps[0];

      // Resolve assignee
      const newAssigneeId = await resolveAssigneeForStep(targetStep.role, requirement.assigneeId);

      // Reset verdicts and go back to review step
      await prisma.requirement.update({
        where: { id: params.id },
        data: {
          reviewVerdicts: { efficiency_manager: null, lobster_partner: null } as any,
          reviewReviewedAt: null,
          currentStep: targetStep.name,
          assigneeId: newAssigneeId,
        },
      });

      await logTransition({
        requirementId: params.id,
        fromStep: 'review_rejected',
        toStep: targetStep.name,
        action: 'advance',
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.internalRole ?? req.user!.role,
        comment: '审查驳回后重新提交',
        metadata: { action: 'resubmit' },
      });

      res.json({
        success: true,
        message: '需求已重新提交审查',
        data: {
          currentStep: targetStep.name,
          currentStepDisplayName: targetStep.displayName,
        },
      });
    }),
  );

  /**
   * POST /:id/dual-track/redo
   * Agent redoes after acceptance_rejected → goes back to dev_self_check
   */
  router.post(
    '/:id/dual-track/redo',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });

      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        include: { workflow: true },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');
      if (!requirement.workflow) throw new HttpError(400, '该需求未分配工作流');

      // Only allow from acceptance_rejected state
      if (requirement.currentStep !== 'acceptance_rejected') {
        throw new HttpError(400, `当前步骤「${requirement.currentStep}」不是验收驳回状态，无法重做`);
      }

      // Check that user is the assignee or admin
      const isAssignee = requirement.assigneeId === req.user!.id;
      const isAdmin = req.user!.role === 'admin' || req.user!.role === 'cto_agent';
      if (!isAssignee && !isAdmin) {
        throw new HttpError(403, '只有需求负责人或管理员可以重做');
      }

      // Get steps - find dev_self_check step
      const steps = parseSteps(requirement.workflow.steps);
      const devStep = steps.find(s => s.name === 'dev_self_check');
      const targetStep = devStep ?? steps[0];

      // Resolve assignee
      const newAssigneeId = await resolveAssigneeForStep(targetStep.role, requirement.assigneeId);

      // Reset acceptance verdicts and go back to dev_self_check
      await prisma.requirement.update({
        where: { id: params.id },
        data: {
          acceptanceVerdicts: { efficiency_manager: null, lobster_partner: null } as any,
          acceptanceReviewedAt: null,
          currentStep: targetStep.name,
          assigneeId: newAssigneeId,
        },
      });

      await logTransition({
        requirementId: params.id,
        fromStep: 'acceptance_rejected',
        toStep: targetStep.name,
        action: 'reject',
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.internalRole ?? req.user!.role,
        comment: '验收驳回后返回开发自检重做',
        metadata: { action: 'redo' },
      });

      res.json({
        success: true,
        message: '需求已返回开发自检阶段重做',
        data: {
          currentStep: targetStep.name,
          currentStepDisplayName: targetStep.displayName,
        },
      });
    }),
  );

  /**
   * POST /:id/dual-track/abandon
   * Agent abandons a rejected requirement
   */
  router.post(
    '/:id/dual-track/abandon',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });

      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');

      const validAbandonSteps = ['review_rejected', 'acceptance_rejected'];
      if (!requirement.currentStep || !validAbandonSteps.includes(requirement.currentStep)) {
        throw new HttpError(400, `当前步骤「${requirement.currentStep}」不能放弃，仅 review_rejected 或 acceptance_rejected 可放弃`);
      }

      // Check that user is the assignee or admin
      const isAssignee = requirement.assigneeId === req.user!.id;
      const isAdmin = req.user!.role === 'admin' || req.user!.role === 'cto_agent';
      if (!isAssignee && !isAdmin) {
        throw new HttpError(403, '只有需求负责人或管理员可以放弃');
      }

      await prisma.requirement.update({
        where: { id: params.id },
        data: { currentStep: 'abandoned' },
      });

      await logTransition({
        requirementId: params.id,
        fromStep: requirement.currentStep,
        toStep: 'abandoned',
        action: 'reject',
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.internalRole ?? req.user!.role,
        comment: '已放弃该需求',
        metadata: { action: 'abandon' },
      });

      res.json({
        success: true,
        message: '需求已放弃',
        data: { status: 'abandoned' },
      });
    }),
  );
}
