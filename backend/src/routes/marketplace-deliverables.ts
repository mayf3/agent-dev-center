import { statSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import {
  createDeliverableSchema,
  marketplaceIdSchema,
  marketplaceTaskIdSchema
} from '../schemas/marketplace.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import {
  getMarketplaceUploadFilenameFromReference,
  getMarketplaceUploadMimeType,
  getMarketplaceUploadPath
} from '../lib/multer.js';
import { archiveRecord } from '../lib/archive.js';

export const marketplaceDeliverablesRouter = Router();

marketplaceDeliverablesRouter.get(
  '/task/:taskId',
  asyncHandler(async (req, res) => {
    const { params } = marketplaceTaskIdSchema.parse({ params: req.params });

    const task = await prisma.marketplaceTask.findUnique({
      where: { id: params.taskId },
      select: { id: true }
    });

    if (!task) {
      throw new HttpError(404, '市场任务不存在');
    }

    const deliverables = await prisma.marketplaceDeliverable.findMany({
      where: { taskId: params.taskId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ data: deliverables });
  })
);

marketplaceDeliverablesRouter.post(
  '/task/:taskId',
  authRequired,
  asyncHandler(async (req, res) => {
    const { params, body } = createDeliverableSchema.parse({
      params: req.params,
      body: req.body
    });

    const task = await prisma.marketplaceTask.findUnique({
      where: { id: params.taskId }
    });

    if (!task) {
      throw new HttpError(404, '市场任务不存在');
    }

    if (task.status === 'completed') {
      throw new HttpError(400, '已完成任务不能新增交付物');
    }

    // For image/document/file types, validate file reference and add metadata
    let finalMetadata = body.metadata as Prisma.InputJsonValue | undefined;
    const { type, content } = body;

    if ((type === 'image' || type === 'document' || type === 'file') && content) {
      const filename = getMarketplaceUploadFilenameFromReference(content);
      if (!filename) {
        throw new HttpError(400, '无效的文件引用，请先上传文件');
      }

      const filePath = getMarketplaceUploadPath(filename);
      try {
        const stats = statSync(filePath);
        const mimeType = getMarketplaceUploadMimeType(filename);

        finalMetadata = {
          ...(typeof finalMetadata === 'object' && finalMetadata !== null ? finalMetadata : {}),
          file: {
            filename,
            size: stats.size,
            mimeType: mimeType || 'application/octet-stream'
          }
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new HttpError(404, '文件不存在，请重新上传');
        }
        throw err;
      }
    }

    const deliverable = await prisma.marketplaceDeliverable.create({
      data: {
        taskId: params.taskId,
        type: body.type,
        title: body.title,
        content: body.content,
        metadata: finalMetadata
      }
    });

    res.status(201).json({ data: deliverable });
  })
);

marketplaceDeliverablesRouter.delete(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const { params } = marketplaceIdSchema.parse({ params: req.params });

    const deliverable = await prisma.marketplaceDeliverable.findUnique({
      where: { id: params.id },
      include: { task: true }
    });

    if (!deliverable) {
      throw new HttpError(404, '交付物不存在');
    }

    if (deliverable.task.status === 'completed') {
      throw new HttpError(400, '已完成任务不能删除交付物');
    }

    // Archive the deliverable record before deleting from DB
    archiveRecord(
      deliverable as unknown as Record<string, unknown>,
      'marketplace/deliverables',
      {
        itemName: deliverable.title || deliverable.id,
        itemId: deliverable.id,
        reason: '用户归档删除交付物',
        archivedBy: req.user!.name || req.user!.email,
        extra: `taskId=${deliverable.taskId}, type=${deliverable.type}`
      }
    );

    await prisma.marketplaceDeliverable.delete({
      where: { id: params.id }
    });

    res.json({ success: true, id: params.id, archived: true });
  })
);
