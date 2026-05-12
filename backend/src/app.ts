import cors from 'cors';
import { randomUUID } from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { authRouter } from './routes/auth.js';
import { requirementsRouter } from './routes/requirements.js';
import { tasksRouter } from './routes/tasks.js';
import { reportsRouter } from './routes/reports.js';
import { notificationsRouter } from './routes/notifications.js';
import { servicesRouter } from './routes/services.js';
import { errorHandler } from './middleware/error-handler.js';
import { HttpError } from './utils/http-error.js';

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

app.use(
  cors({
    origin: env.FRONTEND_ORIGIN === '*' ? true : env.FRONTEND_ORIGIN,
    credentials: true
  })
);
app.use(express.json({ limit: '10mb' }));

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

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/requirements', requirementsRouter);
app.use('/api/requirements/:id/reports', reportsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/services', servicesRouter);

app.use((_req, _res, next) => {
  next(new HttpError(404, '接口不存在'));
});

app.use(errorHandler);
