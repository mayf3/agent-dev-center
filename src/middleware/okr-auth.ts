import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { OkrRole } from '@prisma/client';
import { HttpError } from '../utils/http-error.js';

/**
 * OKR 权限检查中间件
 * 
 * 权限矩阵：
 * - okr_admin (龙虾合伙人): 查看/编辑所有 OKR, 提交周报, 战略审批
 * - okr_reviewer (效率管家): 查看/编辑所有 OKR, 提交周报, 粒度审批
 * - okr_owner (老板): 查看/编辑所有 OKR, 提交周报, 最终审批
 * - okr_member (其他 Agent): 查看所有 OKR, 只能编辑自己的, 提交自己的周报
 */

type OkrAction = 'read' | 'write' | 'write_own' | 'approve';

export function okrAuth(action: OkrAction = 'read'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new HttpError(401, '请先登录'));
    }

    const role = req.user.okrRole || 'okr_member';

    // read: all roles can read all OKRs
    if (action === 'read') {
      return next();
    }

    // Privileged roles can do everything
    const privileged: string[] = [OkrRole.okr_admin, OkrRole.okr_reviewer, OkrRole.okr_owner];
    if (privileged.includes(role)) {
      return next();
    }

    // okr_member: can only write own OKR
    if (action === 'write_own' || action === 'write') {
      // The route handler must check agentId ownership
      // We set a flag so the handler knows to restrict to own resources
      (req as any)._okrMemberRestricted = true;
      return next();
    }

    // approve: only privileged roles
    if (action === 'approve') {
      return next(new HttpError(403, '只有 OKR 管理员/审批人可以审批'));
    }

    return next();
  };
}

/**
 * Check if the current user can operate on the given agent's OKR.
 * Privileged roles can operate on any agent.
 * okr_member can only operate on their own agent.
 */
export function canOperateAgent(user: Express.AuthUser, agentId: string): boolean {
  const privileged: string[] = [OkrRole.okr_admin, OkrRole.okr_reviewer, OkrRole.okr_owner];
  const role = user.okrRole || 'okr_member';
  
  if (privileged.includes(role)) {
    return true;
  }

  // okr_member: check if agentId matches their marketplace agent
  // This requires looking up the user's agent - handled at route level
  return false;
}

/**
 * Get the OKR approval role label for the current user
 */
export function getApprovalRole(role?: string): 'strategic' | 'tactical' | 'boss' | null {
  switch (role) {
    case OkrRole.okr_admin: return 'strategic';
    case OkrRole.okr_reviewer: return 'tactical';
    case OkrRole.okr_owner: return 'boss';
    default: return null;
  }
}
