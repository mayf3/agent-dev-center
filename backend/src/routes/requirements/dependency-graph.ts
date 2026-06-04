/**
 * GET /api/requirements/dependency-graph
 * 返回需求依赖关系图数据
 */
import { Router, Response } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { authRequired, AuthRequest } from '../../middleware/auth.js';

export function registerDependencyGraphRoutes(router: Router): void {
  router.get(
    '/dependency-graph',
    asyncHandler(async (req: AuthRequest, res: Response) => {
      // 获取所有有依赖关系的需求
      const requirements = await prisma.requirement.findMany({
        where: {
          OR: [
            { dependsOnIds: { isEmpty: false } },
            { blockedBy: { isEmpty: false } },
          ],
        },
        select: {
          id: true,
          title: true,
          currentStep: true,
          priority: true,
          status: true,
          dependsOnIds: true,
          blockedBy: true,
        },
      });

      const nodes = requirements.map(r => ({
        id: r.id,
        title: r.title,
        currentStep: r.currentStep,
        priority: r.priority,
        status: r.status,
      }));

      const edges: Array<{ from: string; to: string; type: 'depends-on' }> = [];
      for (const r of requirements) {
        for (const depId of r.dependsOnIds) {
          edges.push({ from: r.id, to: depId, type: 'depends-on' });
        }
      }

      res.json({ nodes, edges });
    })
  );
}
