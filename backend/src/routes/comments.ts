/**
 * 评论系统 — 需求评论 CRUD
 *
 * POST /requirements/:id/comments — 添加评论
 * GET  /requirements/:id/comments — 获取评论列表
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';

export const commentRouter = Router();

const addCommentSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    content: z.string().trim().min(1).max(5000),
  }),
});

const listCommentsSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  }),
});

/**
 * POST /requirements/:id/comments — 添加评论
 */
commentRouter.post(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const { params, body } = addCommentSchema.parse({ params: req.params, body: req.body });
    const user = req.user!;

    // 检查需求存在
    const requirement = await prisma.requirement.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!requirement) throw new HttpError(404, '需求不存在');

    const comment = await prisma.requirementComment.create({
      data: {
        requirementId: params.id,
        authorId: user.id,
        content: body.content,
      },
      include: {
        author: { select: { id: true, name: true, role: true } },
      },
    });

    res.status(201).json({
      success: true,
      data: {
        id: comment.id,
        requirementId: comment.requirementId,
        authorId: comment.authorId,
        authorName: comment.author.name,
        content: comment.content,
        createdAt: comment.createdAt,
      },
    });
  }),
);

/**
 * GET /requirements/:id/comments — 获取评论列表
 */
commentRouter.get(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const { params, query } = listCommentsSchema.parse({ params: req.params, query: req.query });

    // 检查需求存在
    const requirement = await prisma.requirement.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!requirement) throw new HttpError(404, '需求不存在');

    const where = { requirementId: params.id };
    const [comments, total] = await Promise.all([
      prisma.requirementComment.findMany({
        where,
        include: {
          author: { select: { id: true, name: true, role: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.requirementComment.count({ where }),
    ]);

    res.json({
      success: true,
      data: comments.map(c => ({
        id: c.id,
        requirementId: c.requirementId,
        authorId: c.authorId,
        authorName: c.author.name,
        authorRole: c.author.role,
        content: c.content,
        createdAt: c.createdAt,
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  }),
);
