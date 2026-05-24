import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

/**
 * 检查 IP 是否在 CIDR 范围内（支持 IPv4）
 * 支持格式：单个 IP (127.0.0.1) 或 CIDR (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 */
function isIpInCidr(ip: string, cidr: string): boolean {
  const [baseIp, maskBitsStr] = cidr.split('/');
  if (!maskBitsStr) return ip === cidr; // 单个 IP 直接比较

  const maskBits = parseInt(maskBitsStr, 10);
  const ipParts = ip.split('.').map(Number);
  const baseParts = baseIp.split('.').map(Number);

  if (ipParts.length !== 4 || baseParts.length !== 4) return false;
  if (ipParts.some(isNaN) || baseParts.some(isNaN)) return false;

  // 将 IP 转为 32 位整数
  const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
  const baseNum = (baseParts[0] << 24) | (baseParts[1] << 16) | (baseParts[2] << 8) | baseParts[3];

  // 计算子网掩码
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;

  return (ipNum & mask) === (baseNum & mask);
}

/** RFC 1918 私有网段 + 本地回环 */
const PRIVATE_RANGES = [
  '127.0.0.1',      // IPv4 本地回环
  '::1',             // IPv6 本地回环
  '::ffff:127.0.0.1', // IPv4-mapped IPv6 本地回环
  '10.0.0.0/8',     // A 类私有
  '172.16.0.0/12',  // B 类私有
  '192.168.0.0/16', // C 类私有
];

/**
 * 注册接口 IP 白名单中间件
 * 仅允许内网和本地 IP 访问注册接口，拒绝外网恶意注册
 */
export function ipWhitelist(req: Request, res: Response, next: NextFunction): void {
  // 获取真实客户端 IP
  const forwarded = req.headers['x-forwarded-for'] as string | undefined;
  const rawIp = forwarded?.split(',')[0].trim()
    || req.ip
    || req.socket.remoteAddress
    || '';

  // 处理 IPv4-mapped IPv6 地址 (::ffff:10.0.0.1 → 10.0.0.1)
  const clientIp = rawIp.replace(/^::ffff:/, '');

  // IPv6 本地回环直接放行
  if (clientIp === '::1') {
    return next();
  }

  const isAllowed = PRIVATE_RANGES.some(range => isIpInCidr(clientIp, range));

  if (!isAllowed) {
    res.status(403).json({
      error: 'Forbidden',
      message: '注册仅限内网访问',
      requestId: req.requestId
    });
    return;
  }

  next();
}

/**
 * 网关守卫中间件 — 防止直接端口绕过（P0 安全加固）
 *
 * 生产环境强制要求所有 API 请求必须来自：
 * - 本地回环（Nginx 反向代理 localhost → localhost:4000）
 * - 内网地址（RFC 1918）
 *
 * 开发/测试环境不启用（方便本地调试）
 */
export function gatewayGuard(allowedIpsStr?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 开发/测试环境跳过
    if (env.NODE_ENV !== 'production') {
      return next();
    }

    // 健康检查端点放行（监控需要）
    if (req.path === '/api/health') {
      return next();
    }

    // 请求来自 Nginx 反向代理（socket 层面是本地回环或 Docker 网桥）→ 直接放行
    // Nginx 是安全边界，经由 Nginx 转发的请求都是可信的
    // Docker 环境下容器内 socket 源 IP 是 Docker 网桥网关（如 172.17.0.1 / 172.22.0.1），
    // 不是 127.0.0.1，所以需要检查 RFC 1918 私有网段
    const socketAddr = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const isSocketTrusted = PRIVATE_RANGES.some(range => isIpInCidr(socketAddr, range));
    if (isSocketTrusted) {
      return next();
    }

    // 解析额外允许的 IP（从环境变量）
    const extraIps = allowedIpsStr?.split(',').map(s => s.trim()).filter(Boolean) || [];

    const allowedRanges = [...PRIVATE_RANGES, ...extraIps];

    // 获取真实客户端 IP（优先 X-Forwarded-For）
    const forwarded = req.headers['x-forwarded-for'] as string | undefined;
    const rawIp = forwarded?.split(',')[0].trim()
      || req.ip
      || req.socket.remoteAddress
      || '';

    // 处理 IPv4-mapped IPv6 地址
    const clientIp = rawIp.replace(/^::ffff:/, '');

    // IPv6 本地回环放行
    if (clientIp === '::1') {
      return next();
    }

    const isAllowed = allowedRanges.some(range => isIpInCidr(clientIp, range));

    if (!isAllowed) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Direct access is not allowed',
        requestId: req.requestId
      });
      return;
    }

    next();
  };
}

/**
 * 仅允许本地访问（最严格）
 *
 * 只允许 127.0.0.1 和 ::1，用于敏感操作：
 * - Agent 注册（只能由内部服务调用）
 * - 管理员强制操作
 */
export function internalOnly(req: Request, res: Response, next: NextFunction): void {
  const forwarded = req.headers['x-forwarded-for'] as string | undefined;
  const rawIp = forwarded?.split(',')[0].trim()
    || req.ip
    || req.socket.remoteAddress
    || '';

  const clientIp = rawIp.replace(/^::ffff:/, '');

  // 只允许本地回环
  const isLocal =
    clientIp === '127.0.0.1' ||
    clientIp === '::1' ||
    clientIp === 'localhost';

  if (!isLocal) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Internal access only',
      requestId: req.requestId
    });
    return;
  }

  next();
}
