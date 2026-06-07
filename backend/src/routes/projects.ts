/**
 * Project 路由 — ADC 平台项目管理
 *
 * 每个项目的功能清单、产品边界、关联需求
 */
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /api/projects — 项目列表
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize)) || 10));
    const skip = (page - 1) * pageSize;

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          owner: { select: { id: true, name: true } },
        },
      }),
      prisma.project.count(),
    ]);

    res.json({ data: projects, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
  }),
);

/**
 * GET /api/projects/:id — 项目详情
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true } },
      },
    });

    if (!project) throw new HttpError(404, '项目不存在');
    res.json(project);
  }),
);

/**
 * POST /api/projects — 创建项目
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, description, boundaries, featureList } = req.body;

    if (!name || name.trim().length === 0) {
      throw new HttpError(400, '项目名称不能为空');
    }

    const existing = await prisma.project.findUnique({ where: { name: name.trim() } });
    if (existing) throw new HttpError(409, '项目名称已存在');

    const project = await prisma.project.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        boundaries: boundaries?.trim() || null,
        featureList: featureList?.trim() || null,
        ownerId: req.user?.id || null,
      },
    });

    res.status(201).json(project);
  }),
);

/**
 * PUT /api/projects/:id — 更新项目
 */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, '项目不存在');

    const { name, description, boundaries, featureList, status } = req.body;

    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(boundaries !== undefined && { boundaries: boundaries?.trim() || null }),
        ...(featureList !== undefined && { featureList: featureList?.trim() || null }),
        ...(status !== undefined && { status }),
      },
    });

    res.json(project);
  }),
);

/**
 * DELETE /api/projects/:id — 删除项目
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, '项目不存在');

    await prisma.project.delete({ where: { id } });
    res.json({ message: '项目已删除' });
  }),
);

export default router;
