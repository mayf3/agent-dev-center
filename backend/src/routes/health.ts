import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'agent-dev-center-backend',
    timestamp: new Date().toISOString(),
  });
});

export const router = healthRouter;
export const mountPath = '/api/health';
