import type { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import type { Permission } from '../schemas/agent-sso.js';
import { isPlatformAdmin } from '../lib/platform-roles.js';

/**
 * Agent 权限守卫中间件
 *
 * 用法: router.get('/path', agentPermission('todo:read'), handler)
 *
 * 支持两种认证方式：
 * 1. 用户 JWT（admin 角色自动通过）
 * 2. Agent Token（检查 permissions 数组）
 */
export function agentPermission(required: Permission | 'admin') {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    // 情况 1: 用户 JWT 认证（admin 角色自动通过）
    if (req.user) {
      if (isPlatformAdmin(req.user)) return next();

      // 查 user 的 permissions
      const { prisma } = await import('../lib/prisma.js');
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { permissions: true, role: true, internalRole: true, roles: true },
      });

      if (user) {
        if (isPlatformAdmin(user)) return next();

        const perms = (user.permissions as string[]) ?? [];
        if (perms.includes('admin') || perms.includes(required)) {
          return next();
        }
      }

      throw new HttpError(403, `权限不足: 需要 ${required}`);
    }

    // 情况 2: Agent Token 认证
    if (req.agentAuth) {
      // agentAuth 是从 agent_access_tokens 解析的
      // 需要查 user 表的 permissions
      const { prisma } = await import('../lib/prisma.js');
      const user = await prisma.user.findFirst({
        where: { agentId: req.agentAuth.agentId },
        select: { permissions: true, role: true, internalRole: true, roles: true },
      });

      if (user) {
        if (isPlatformAdmin(user)) return next();

        const perms = (user.permissions as string[]) ?? [];
        if (perms.includes('admin') || perms.includes(required)) {
          return next();
        }
      }

      throw new HttpError(403, `Agent 权限不足: 需要 ${required}`);
    }

    throw new HttpError(401, '请先登录');
  });
}
