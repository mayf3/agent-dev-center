import { Router } from 'express';
import { registerAuthRoutes } from './auth.js';
import { registerAdminRoutes } from './admin.js';

export const agentSsoRouter = Router();

registerAuthRoutes(agentSsoRouter);
registerAdminRoutes(agentSsoRouter);
