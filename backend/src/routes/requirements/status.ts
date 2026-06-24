import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';

export function registerStatusRoutes(router: import('express').Router): void {

  // GET /users/list - 用户列表（保留，工作流分配时需要）
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

}
