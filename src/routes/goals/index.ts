import { Router } from 'express';
import { registerCoreRoutes } from './core.js';
import { registerLifecycleRoutes } from './lifecycle.js';

export const goalsRouter = Router();

registerCoreRoutes(goalsRouter);
registerLifecycleRoutes(goalsRouter);
export const router = goalsRouter;
export const mountPath = '/api/goals';
