import cors from 'cors';
import { randomUUID } from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

const corsAllowedOrigins = (env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((origin: string) => origin.trim())
  .filter(Boolean);

if (corsAllowedOrigins.length === 0 && env.NODE_ENV === 'production') {
  console.warn('[CORS] FRONTEND_ORIGIN not set in production — CORS disabled, only same-origin allowed');
}

export function applyCoreMiddleware(app: Express): void {
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const requestId = randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });

  app.use(
    cors({
      origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        if (!origin) return callback(null, false);
        if (corsAllowedOrigins.length === 0) return callback(null, false);
        if (corsAllowedOrigins.includes('*')) return callback(null, true);
        const allowed = corsAllowedOrigins.some((allowedOrigin: string) => origin.startsWith(allowedOrigin));
        if (allowed) return callback(null, true);
        return callback(null, false);
      },
      credentials: corsAllowedOrigins.length > 0,
    })
  );

  app.use((_req, res, next) => {
    if (env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.removeHeader('X-Powered-By');
    next();
  });

  app.use(express.json({ limit: '10mb' }));

  app.use((req, res, next) => {
    const requestPath = req.path.toLowerCase();
    const blockedPatterns = [
      '/.ds_store', '.ds_store',
      '/.env', '.env.local', '.env.production',
      '/.git/', '/.gitignore',
      '.sql', '.dump', '.backup',
      '/.htaccess', '/.htpasswd',
      '/wp-admin', '/wp-config',
      '/phpmyadmin',
    ];
    if (blockedPatterns.some(pattern => requestPath.includes(pattern))) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    next();
  });

  app.use((err: Error & { type?: string }, _req: Request, _res: Response, next: NextFunction) => {
    if (err.type === 'entity.parse.failed') {
      return next(new HttpError(400, '请求体 JSON 格式不正确'));
    }
    next(err);
  });
}
