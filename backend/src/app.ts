import cors from 'cors';
import { randomUUID } from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { gatewayGuard } from './middleware/ip-whitelist.js';
import { HttpError } from './utils/http-error.js';
import { mustChangePasswordGuard } from './middleware/must-change-password.js';
import { autoRegisterRoutes } from './utils/route-registry.js';

export const app = express();

// ─── 核心中间件 ─────────────────────────────────────────

// Nginx 反向代理，需要信任 proxy header
app.set('trust proxy', 1);

// 隐藏 X-Powered-By 头
app.disable('x-powered-by');

app.use((req, res, next) => {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});

// d7e0a85d: 生产环境禁止 localhost CORS，需显式配置 FRONTEND_ORIGIN
const corsOrigin = env.FRONTEND_ORIGIN === '*' ? true : env.FRONTEND_ORIGIN;
if (!corsOrigin && env.NODE_ENV === 'production') {
  console.warn('[CORS] FRONTEND_ORIGIN not set in production — CORS disabled, only same-origin allowed');
}
app.use(
  cors({
    origin: corsOrigin || false,
    credentials: !!env.FRONTEND_ORIGIN && env.FRONTEND_ORIGIN !== ''
  })
);

// 安全头：HSTS + XSS 保护 + Content-Type 防嗅探 + 点击劫持防护
app.use((req, res, next) => {
  if (env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.removeHeader('X-Powered-By');
  next();
});
if (env.NODE_ENV === 'production') {
  app.use(gatewayGuard());
}
app.use(express.json({ limit: '10mb' }));

// 6f5879d5: 禁止访问敏感文件
app.use((req, res, next) => {
  const path = req.path.toLowerCase();
  const blockedPatterns = [
    '/.ds_store', '.ds_store',
    '/.env', '.env.local', '.env.production',
    '/.git/', '/.gitignore',
    '.sql', '.dump', '.backup',
    '/.htaccess', '/.htpasswd',
    '/wp-admin', '/wp-config',
    '/phpmyadmin',
  ];
  if (blockedPatterns.some(p => path.includes(p))) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  next();
});

// Initialize archive directory on startup
import { ensureArchiveRoot } from './lib/archive.js';
ensureArchiveRoot();

// JSON 解析错误处理（BUG-001 修复）
app.use((err: Error & { type?: string }, _req: express.Request, _res: express.Response, next: express.NextFunction) => {
  if (err.type === 'entity.parse.failed') {
    return next(new HttpError(400, '请求体 JSON 格式不正确'));
  }
  next(err);
});

// 登录/注册速率限制：15分钟内最多50次请求
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: '请求过于频繁，请稍后再试'
});

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'agent-dev-center-backend',
    timestamp: new Date().toISOString()
  });
});

// ─── 路由自动注册（约定优于配置）──────────────────────────
// 自动加载 routes/ 目录下所有带 mountPath + router 导出的模块
// 认证路由（/api/auth, /api/auth/sso）在 autoRegisterRoutes 中注册，
// authLimiter 通过局部中间件在路由内部生效
await autoRegisterRoutes(app);

// SSO 路由和 Auth 路由的速率限制由路由文件内部应用 authLimiter

// mustChangePassword 拦截：认证后检查是否需要强制改密码
app.use('/api', mustChangePasswordGuard);

// 404
app.use((_req, _res, next) => {
  next(new HttpError(404, '接口不存在'));
});

// 全局错误处理
app.use(errorHandler);
