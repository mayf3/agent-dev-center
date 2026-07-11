import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'agent-dev-center-backend',
    timestamp: new Date().toISOString(),
    buildCommit: process.env.BUILD_COMMIT || 'development',
    buildTimestamp: process.env.BUILD_TIMESTAMP || 'development',
    runtimeEntry: 'dist/src/server.js',
    nodeVersion: process.version,
  });
});

export const router = healthRouter;
export const mountPath = '/api/health';
