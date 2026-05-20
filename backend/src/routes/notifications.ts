import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authRequired } from '../middleware/auth.js';
import { registerSSEClient } from '../utils/notifications.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { archiveRecord } from '../lib/archive.js';

export const notificationsRouter = Router();

notificationsRouter.use(authRequired);

/**
 * GET /api/notifications
 * 获取当前用户的通知列表（分页）
 * Query: page=1, limit=20, unread=true
 */
notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const unreadOnly = req.query.unread === 'true';

    const where = {
      OR: [{ userId: user.id }, { userId: null }],
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          OR: [{ userId: user.id }, { userId: null }],
          isRead: false,
        },
      }),
    ]);

    res.json({
      items,
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  })
);

/**
 * GET /api/notifications/stream
 * SSE 实时推送
 */
notificationsRouter.get('/stream', (req, res) => {
  const user = req.user!;
  if (!user || !user.id) {
    res.status(401).json({ error: '未认证' });
    return;
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Nginx 兼容
  });

  // 发送初始心跳
  res.write(`event: connected\ndata: ${JSON.stringify({ userId: user.id, timestamp: new Date().toISOString() })}\n\n`);

  // 注册 SSE 客户端
  registerSSEClient(user.id, res);

  // 每 30 秒发送心跳保活
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 30_000);

  res.on('close', () => {
    clearInterval(heartbeat);
  });
});

/**
 * GET /api/notifications/unread-count
 * 获取未读通知数量
 */
notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const count = await prisma.notification.count({
      where: {
        OR: [{ userId: user.id }, { userId: null }],
        isRead: false,
      },
    });
    res.json({ unreadCount: count });
  })
);

/**
 * PATCH /api/notifications/:id
 * 标记单条通知已读
 */
notificationsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);

    const notification = await prisma.notification.findFirst({
      where: {
        id,
        OR: [{ userId: user.id }, { userId: null }],
      },
    });

    if (!notification) {
      throw new HttpError(404, '通知不存在');
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    res.json(updated);
  })
);

/**
 * POST /api/notifications/read-all
 * 全部标记已读
 */
notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const user = req.user!;

    const result = await prisma.notification.updateMany({
      where: {
        OR: [{ userId: user.id }, { userId: null }],
        isRead: false,
      },
      data: { isRead: true },
    });

    res.json({ ok: true, markedCount: result.count });
  })
);

/**
 * DELETE /api/notifications/:id
 * 删除单条通知
 */
notificationsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);

    const notification = await prisma.notification.findFirst({
      where: {
        id,
        OR: [{ userId: user.id }, { userId: null }],
      },
    });

    if (!notification) {
      throw new HttpError(404, '通知不存在');
    }

    // Archive the notification before deleting
    archiveRecord(
      notification as unknown as Record<string, unknown>,
      'notifications',
      {
        itemName: notification.title || notification.id,
        itemId: notification.id,
        reason: '用户归档删除通知',
        archivedBy: user.name || user.email
      }
    );

    await prisma.notification.delete({ where: { id } });
    res.json({ ok: true, archived: true });
  })
);
