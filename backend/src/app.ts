import cors from 'cors';
import { randomUUID } from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { authRouter } from './routes/auth.js';
import { requirementsRouter } from './routes/requirements/index.js';
import { tasksRouter } from './routes/tasks.js';
import { reportsRouter } from './routes/reports.js';
import { notificationsRouter } from './routes/notifications.js';
import { servicesRouter } from './routes/services.js';
import { marketplaceAgentsRouter } from './routes/marketplace/marketplace-agents.js';
import { marketplaceTasksRouter } from './routes/marketplace/marketplace-tasks.js';
import { marketplaceDeliverablesRouter } from './routes/marketplace/marketplace-deliverables.js';
import { marketplaceUploadsRouter } from './routes/marketplace/marketplace-uploads.js';
import { marketplaceAutomationRouter } from './routes/marketplace/marketplace-automation.js';
import { goalsRouter } from './routes/goals/index.js';
import { postmortemsRouter } from './routes/postmortems.js';
import { commentsRouter } from './routes/comments.js';
import { errorHandler } from './middleware/error-handler.js';
import { gatewayGuard } from './middleware/ip-whitelist.js';
import { HttpError } from './utils/http-error.js';
import { agentsRouter } from './routes/agents/index.js';
import { ssoRouter } from './routes/sso.js';
import { agentSsoRouter } from './routes/agent-sso/index.js';
import { profileRouter } from './routes/profile.js';
import { skillTreeRouter } from './routes/skill-tree.js';
import { roadmapRouter } from './routes/roadmap.js';
import { identitiesRouter } from './routes/identities.js';
import { healthRecordsRouter } from './routes/health-records.js';
import { familyRouter } from './routes/family.js';
import projectsRouter from './routes/projects.js';
import { adminUsersRouter } from './routes/admin-users.js';
import { dailyLogsRouter } from './routes/daily-logs.js';
import { operationsRouter } from './routes/operations.js';
import { mustChangePasswordGuard } from './middleware/must-change-password.js';

export const app = express();

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
  res.setHeader('X-XSS-Protection', '0'); // 现代浏览器推荐禁用，依赖 CSP
  res.removeHeader('X-Powered-By');
  next();
});
if (env.NODE_ENV === 'production') {
  app.use(gatewayGuard());
}
app.use(express.json({ limit: '10mb' }));

// 6f5879d5: 禁止访问敏感文件（.DS_Store, .sql, .env, .git 等）
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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'agent-dev-center-backend',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/auth/sso', authLimiter, ssoRouter);
app.use('/api/auth/agent', agentSsoRouter);
app.use('/api/auth', authLimiter, authRouter);
// mustChangePassword 拦截：认证后检查是否需要强制改密码
app.use('/api', mustChangePasswordGuard);
app.use('/api/requirements', requirementsRouter);
app.use('/api/requirements/:id/reports', reportsRouter);
app.use('/api/requirements', commentsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/services', servicesRouter);
app.use('/api/marketplace/agents', marketplaceAgentsRouter);
app.use('/api/marketplace/tasks', marketplaceTasksRouter);
app.use('/api/marketplace/deliverables', marketplaceDeliverablesRouter);
app.use('/api/marketplace/uploads', marketplaceUploadsRouter);
app.use('/api/marketplace', marketplaceAutomationRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/postmortems', postmortemsRouter);
app.use('/api/profile', profileRouter);
app.use('/api/skill-tree', skillTreeRouter);
app.use('/api/roadmap', roadmapRouter);
app.use('/api/health-records', healthRecordsRouter);
app.use('/api/family', familyRouter);
app.use('/api/identities', identitiesRouter);
app.use('/api/admin/users', adminUsersRouter);
app.use('/api/daily-logs', dailyLogsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/operations', operationsRouter);

app.use((_req, _res, next) => {
  next(new HttpError(404, '接口不存在'));
});

app.use(errorHandler);
