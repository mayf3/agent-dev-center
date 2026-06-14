import { Router } from 'express';
import { registerCoreRoutes } from './core.js';
import { registerReportsRoutes } from './reports.js';
import { registerOkrRoutes } from './okr.js';

export const agentsRouter = Router();

registerCoreRoutes(agentsRouter);
registerReportsRoutes(agentsRouter);
registerOkrRoutes(agentsRouter);
export const router = agentsRouter;
export const mountPath = '/api/agents';
