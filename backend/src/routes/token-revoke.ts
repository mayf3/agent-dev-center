/**
 * Self-Service Token Revocation Routes
 * 
 * 用户吊销自己的 token:
 * - POST /api/tokens/revoke — 吊销当前用户的指定 token
 * - POST /api/tokens/revoke/all — 吊销当前用户所有 token（密码轮换后使用）
 */

import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { revokeToken, revokeAllUserTokens } from '../services/token-revoke.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';

export const router = Router();
export const mountPath = '/api/tokens';

// 需要登录
router.use(authRequired);

/**
 * POST /api/tokens/revoke
 * 吊销当前用户的指定 token
 * Body: { jti: string, reason?: string }
 */
router.post('/revoke', asyncHandler(async (req, res) => {
  const { jti, reason } = req.body;

  if (!jti) {
    throw new HttpError(400, '缺少必填参数: jti');
  }

  await revokeToken(jti, req.user!.id, reason || '用户主动吊销');

  res.json({
    success: true,
    message: '令牌已吊销',
  });
}));

/**
 * POST /api/tokens/revoke/all
 * 吊销当前用户所有 token（密码轮换后使用）
 * Body: { reason?: string }
 */
router.post('/revoke/all', asyncHandler(async (req, res) => {
  const { reason } = req.body;

  await revokeAllUserTokens(req.user!.id, reason || '用户主动全量吊销');

  res.json({
    success: true,
    message: '已吊销所有活跃令牌',
  });
}));
