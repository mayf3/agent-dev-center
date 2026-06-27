/**
 * Token Revocation Service
 * 
 * 支持通过 JTI（令牌ID）吊销单个 token，以及按用户吊销所有 token。
 * 配合 auth.ts middleware 实现 JTI denylist 检查。
 */

import { prisma } from '../lib/prisma.js';
import { HttpError } from '../utils/http-error.js';

const TOKEN_TTL_SECONDS = 7 * 24 * 3600; // 默认保留 7 天（超过 JWT 过期时间即可）

/**
 * 吊销单个 token（通过 JTI）
 */
export async function revokeToken(jti: string, userId: string, reason?: string): Promise<void> {
  // 检查是否已吊销
  const existing = await prisma.revokedToken.findUnique({ where: { jti } });
  if (existing) {
    throw new HttpError(409, '该令牌已被吊销');
  }

  // 计算 expiresAt: JTI 格式为 "userId-timestamp-random"，从 timestamp 推算
  // 但更安全的是统一保留默认时间
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);

  await prisma.revokedToken.create({
    data: {
      jti,
      userId,
      reason: reason || '管理员吊销',
      expiresAt,
    },
  });
}

/**
 * 吊销用户的所有活跃 token
 * 通过吊销所有该用户的 JTIs（适用于密码轮换场景）
 */
export async function revokeAllUserTokens(userId: string, reason?: string): Promise<number> {
  // 注意：我们无法知道用户所有未过期的 JTI，因此插入一个「用户级吊销标记」
  // 配合 auth.ts 中的「用户全量吊销检查」
  
  // 实际实现：在 User 上增加 revokedBefore 时间戳，或插入特殊格式的 jti
  // 这里使用一个特殊的用户级吊销记录
  const markerJti = `user-revoke-${userId}-${Date.now()}`;
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);

  await prisma.revokedToken.create({
    data: {
      jti: markerJti,
      userId,
      reason: reason || '用户级全量吊销（密码轮换）',
      expiresAt,
    },
  });

  return 1;
}

/**
 * 检查 token 是否已被吊销
 * 返回 true 表示已吊销（应拒绝），false 表示有效
 */
export async function isTokenRevoked(jti: string, userId: string): Promise<boolean> {
  // 1. 检查单个 JTI 是否在吊销列表中
  const revokedJti = await prisma.revokedToken.findFirst({
    where: {
      jti,
      OR: [
        { expiresAt: null },
        { expiresAt: { gte: new Date() } },
      ],
    },
  });
  
  if (revokedJti) {
    return true;
  }

  // 2. 检查是否有用户级全量吊销（发生在该 token 签发之后）
  const userRevoke = await prisma.revokedToken.findFirst({
    where: {
      userId,
      jti: { startsWith: 'user-revoke-' },
      OR: [
        { expiresAt: null },
        { expiresAt: { gte: new Date() } },
      ],
    },
    orderBy: { revokedAt: 'desc' },
  });

  if (userRevoke) {
    // 从 JTI 的时间戳判断：如果用户级吊销发生在 JTI 签发之后，则拒绝
    // JTI 格式: userId-timestamp-random
    const jtiParts = jti.split('-');
    if (jtiParts.length >= 2) {
      const jtiTimestamp = parseInt(jtiParts[1], 10);
      const revokeTimestamp = Math.floor(userRevoke.revokedAt.getTime() / 1000);
      if (jtiTimestamp < revokeTimestamp) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 清理过期的吊销记录
 */
export async function cleanExpiredRevocations(): Promise<number> {
  const result = await prisma.revokedToken.deleteMany({
    where: {
      expiresAt: { lte: new Date() },
    },
  });
  return result.count;
}
