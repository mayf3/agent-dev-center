import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requireRoles } from '../../middleware/auth.js';
import { getWipInfo } from '../../middleware/internal-workflow.js';
import { getActiveRequirementCount } from '../../lib/assignee-resolver.js';

export function registerStatusRoutes(router: import('express').Router): void {

  // GET /users/list - 用户列表
  router.get(
    '/users/list',
    asyncHandler(async (_req, res) => {
      const users = await prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true },
        orderBy: { createdAt: 'asc' }
      });
      res.json({ data: users });
    })
  );

  // GET /users/wip-summary - 所有用户的 WIP 负载摘要（admin/cto only）
  router.get(
    '/users/wip-summary',
    requireRoles('admin', 'cto_agent'),
    asyncHandler(async (_req, res) => {
      const users = await prisma.user.findMany({
        select: { id: true, name: true, internalRole: true, wipLimit: true },
        orderBy: [{ internalRole: 'asc' }, { name: 'asc' }],
      });

      const result = await Promise.all(
        users.map(async (u) => {
          const activeCount = await getActiveRequirementCount(u.id);
          const limit = u.wipLimit ?? 2;
          return {
            id: u.id,
            name: u.name,
            internalRole: u.internalRole,
            wipLimit: limit,
            activeCount,
            remaining: limit - activeCount,
            isOverloaded: activeCount > limit,
          };
        }),
      );

      res.json({ data: result });
    })
  );

  // GET /users/:id/wip - 指定用户的 WIP 信息
  router.get(
    '/users/:id/wip',
    asyncHandler(async (req, res) => {
      const id = req.params.id as string;
      const info = await getWipInfo(id);
      const user = await prisma.user.findUnique({
        where: { id },
        select: { name: true, internalRole: true },
      });
      if (!user) throw new HttpError(404, '用户不存在');

      res.json({
        data: {
          id,
          name: user.name,
          internalRole: user.internalRole,
          ...info,
        },
      });
    })
  );

  // PATCH /users/:id/wip - 设置用户的 WIP 上限（admin/cto only）
  router.patch(
    '/users/:id/wip',
    requireRoles('admin', 'cto_agent'),
    asyncHandler(async (req, res) => {
      const id = req.params.id as string;
      const body = z.object({
        wipLimit: z.number().int().min(1).max(100),
      }).parse(req.body);

      const user = await prisma.user.findUnique({
        where: { id },
        select: { name: true, wipLimit: true },
      });
      if (!user) throw new HttpError(404, '用户不存在');

      const updated = await prisma.user.update({
        where: { id },
        data: { wipLimit: body.wipLimit },
        select: { id: true, name: true, wipLimit: true },
      });

      await prisma.auditLog.create({
        data: {
          action: 'SET_WIP_LIMIT',
          actorId: req.user!.id,
          actorName: req.user!.name,
          targetId: id,
          targetType: 'User',
          details: {
            userName: user.name,
            oldLimit: user.wipLimit,
            newLimit: body.wipLimit,
          } as any,
        },
      });

      res.json({ data: updated });
    })
  );

}
