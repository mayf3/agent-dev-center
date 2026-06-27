/**
 * Token Revocation Routes
 * 
 * 提供 JTI denylist 管理 API：
 * - POST /api/admin/tokens/revoke — 吊销单个 token
 * - POST /api/admin/tokens/revoke/user/:userId — 吊销用户所有 token
 * - GET /api/admin/tokens/revoked — 查询已吊销的 token 列表
 */

import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authRequired, requireRoles } from '../../middleware/auth.js';
import { revokeToken, revokeAllUserTokens, cleanExpiredRevocations } from '../../services/token-revoke.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

export const router = Router();
export const mountPath = '/api/admin/tokens';

// 所有端点需要 admin 角色
router.use(authRequired);
router.use(requireRoles('admin'));

/**
 * POST /api/admin/tokens/revoke
 * 吊销单个 token
 * Body: { jti: string, userId: string, reason?: string }
 */
router.post('/revoke', asyncHandler(async (req, res) => {
  const { jti, userId, reason } = req.body;

  if (!jti || !userId) {
    throw new HttpError(400, '缺少必填参数: jti, userId');
  }

  await revokeToken(jti, userId, reason);

  res.json({
    success: true,
    message: '令牌已吊销',
  });
}));

/**
 * POST /api/admin/tokens/revoke/user/:userId
 * 吊销指定用户的所有活跃 token（适用于密码轮换）
 * Body: { reason?: string }
 */
router.post('/revoke/user/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { reason } = req.body;

  if (!userId) {
    throw new HttpError(400, '缺少必填参数: userId');
  }

  const count = await revokeAllUserTokens(userId as string, reason);

  res.json({
    success: true,
    message: `已吊销用户 ${userId} 的 ${count} 个令牌`,
  });
}));

/**
 * GET /api/admin/tokens/revoked
 * 查询已吊销（且未过期）的 token 列表
 * Query: ?userId=xxx&limit=50
 */
router.get('/revoked', asyncHandler(async (req, res) => {
  const userId = req.query.userId as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

  const where: Record<string, unknown> = {
    OR: [
      { expiresAt: null },
      { expiresAt: { gte: new Date() } },
    ],
  };

  if (userId) {
    where.userId = userId;
  }

  const tokens = await prisma.revokedToken.findMany({
    where,
    orderBy: { revokedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      jti: true,
      userId: true,
      reason: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  res.json(tokens);
}));

/**
 * POST /api/admin/tokens/revoked/cleanup
 * 手动清理过期的吊销记录
 */
router.post('/revoked/cleanup', asyncHandler(async (_req, res) => {
  const count = await cleanExpiredRevocations();

  res.json({
    success: true,
    message: `已清理 ${count} 条过期吊销记录`,
  });
}));
