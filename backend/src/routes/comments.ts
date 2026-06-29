import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { domainScope } from '../middleware/domain-scope.js';
import { assertDomainReadAccess } from './requirements/utils.js';

const router = Router();

// All comment routes require authentication + domain scope
router.use(authRequired);
router.use(domainScope);

function param(req: { params: Record<string, string | string[]> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Load requirement and check domain access. Returns the requirement. */
async function requireAccessibleRequirement(id: string, user: Express.AuthUser): Promise<{ id: string; domainKey: string | null }> {
  const requirement = await prisma.requirement.findUnique({
    where: { id },
    select: { id: true, domainKey: true },
  });
  if (!requirement) throw new HttpError(404, '需求不存在');
  assertDomainReadAccess(user, requirement);
  return requirement;
}

/**
 * GET /api/requirements/:id/comments
 * List comments for a requirement (paginated, threaded)
 */
router.get('/:id/comments', asyncHandler(async (req, res) => {
  const id = param(req, 'id');
  await requireAccessibleRequirement(id, req.user!);

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const status = req.query.status as string | undefined;

  const where: Record<string, unknown> = { requirementId: id };
  if (status) where.status = status;

  const [comments, total] = await Promise.all([
    prisma.requirementComment.findMany({
      where: { ...where, parentId: null },
      include: {
        author: { select: { id: true, name: true, email: true, avatar: true } },
        replies: {
          include: {
            author: { select: { id: true, name: true, email: true, avatar: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.requirementComment.count({ where: { ...where, parentId: null } }),
  ]);

  res.json({
    comments,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}));

/**
 * POST /api/requirements/:id/comments
 * Add a comment to a requirement
 */
router.post('/:id/comments', asyncHandler(async (req, res) => {
  const id = param(req, 'id');
  await requireAccessibleRequirement(id, req.user!);

  const userId = req.user!.id;
  const { content, parentId, type, mentions } = req.body as {
    content?: string;
    parentId?: string;
    type?: string;
    mentions?: string[];
  };

  if (!content || !content.trim()) throw new HttpError(400, '评论内容不能为空');

  // Validate parentId if provided
  if (parentId) {
    const parent = await prisma.requirementComment.findUnique({ where: { id: parentId } });
    if (!parent || parent.requirementId !== id) {
      throw new HttpError(400, '父评论不存在或不属于该需求');
    }
  }

  const comment = await prisma.requirementComment.create({
    data: {
      requirementId: id,
      content: content.trim(),
      authorId: userId,
      parentId: parentId || null,
      type: type || 'discussion',
      mentions: mentions || [],
    },
    include: {
      author: { select: { id: true, name: true, email: true, avatar: true } },
    },
  });

  res.status(201).json({ comment });
}));

/**
 * PATCH /api/requirements/:id/comments/:commentId
 * Update comment status (resolve/archive)
 */
router.patch('/:id/comments/:commentId', asyncHandler(async (req, res) => {
  const id = param(req, 'id'); const commentId = param(req, 'commentId');
  await requireAccessibleRequirement(id, req.user!);

  const { status, content } = req.body as { status?: string; content?: string };
  const userId = req.user!.id;

  const comment = await prisma.requirementComment.findUnique({ where: { id: commentId } });
  if (!comment || comment.requirementId !== id) throw new HttpError(404, '评论不存在');

  if (content !== undefined && comment.authorId !== userId && req.user!.role !== 'admin') {
    throw new HttpError(403, '只能编辑自己的评论');
  }

  const validStatuses = ['open', 'resolved', 'archived'];
  if (status && !validStatuses.includes(status)) {
    throw new HttpError(400, `无效状态，允许: ${validStatuses.join(', ')}`);
  }

  const updated = await prisma.requirementComment.update({
    where: { id: commentId },
    data: {
      ...(content !== undefined ? { content: content.trim() } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      author: { select: { id: true, name: true, email: true, avatar: true } },
    },
  });

  res.json({ comment: updated });
}));

/**
 * DELETE /api/requirements/:id/comments/:commentId
 * Soft delete (archive) a comment
 */
router.delete('/:id/comments/:commentId', asyncHandler(async (req, res) => {
  const id = param(req, 'id'); const commentId = param(req, 'commentId');
  await requireAccessibleRequirement(id, req.user!);

  const userId = req.user!.id;

  const comment = await prisma.requirementComment.findUnique({ where: { id: commentId } });
  if (!comment || comment.requirementId !== id) throw new HttpError(404, '评论不存在');

  if (comment.authorId !== userId && req.user!.role !== 'admin') {
    throw new HttpError(403, '只能删除自己的评论');
  }

  await prisma.requirementComment.update({
    where: { id: commentId },
    data: { status: 'archived' },
  });

  res.status(204).send();
}));

export const commentsRouter = router;
export { router };
export const mountPath = '/api/requirements';
