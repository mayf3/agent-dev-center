import type { Request, Response, NextFunction } from 'express';

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
const ALLOWED_RANGES = [
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

  const isAllowed = ALLOWED_RANGES.some(range => isIpInCidr(clientIp, range));

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
