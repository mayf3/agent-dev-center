import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { asyncHandler } from '../utils/async-handler.js';

/**
 * Agent Token 认证中间件
 *
 * 验证 Agent 专用的 token（前缀 agent_）。
 * 注入 req.agentAuth = { agentId, agentName }
 */
export interface AgentAuth {
  agentId: string;
  agentName: string;
  tokenId: string;
}

declare global {
  namespace Express {
    interface Request {
      agentAuth?: AgentAuth;
    }
  }
}

export const agentTokenRequired = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');

  if (!token) {
    throw new HttpError(401, '请提供 Agent Token');
  }

  // Agent token 以 agent_ 为前缀
  if (!token.startsWith('agent_')) {
    throw new HttpError(401, '无效的 Agent Token 格式');
  }

  // 查找 token
  const accessToken = await prisma.agentAccessToken.findFirst({
    where: { token },
    include: { agent: { select: { id: true, name: true } } },
  });

  if (!accessToken) {
    throw new HttpError(401, 'Agent Token 无效');
  }

  // 检查过期
  if (accessToken.expiresAt && accessToken.expiresAt < new Date()) {
    throw new HttpError(401, 'Agent Token 已过期');
  }

  // 更新最后使用时间
  await prisma.agentAccessToken.update({
    where: { id: accessToken.id },
    data: { lastUsedAt: new Date() },
  });

  req.agentAuth = {
    agentId: accessToken.agentId,
    agentName: accessToken.agent.name,
    tokenId: accessToken.id,
  };

  next();
});
