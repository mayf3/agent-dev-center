import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { registerCrudRoutes } from './crud.js';
import { registerWorkflowRoutes } from './workflow.js';
import { registerReportRoutes } from './reports.js';
import { registerDecomposeRoutes } from './decompose.js';

export const requirementsRouter = Router();

requirementsRouter.use(authRequired);

// Routes are registered in the same order as the original file
registerCrudRoutes(requirementsRouter);
registerWorkflowRoutes(requirementsRouter);
registerReportRoutes(requirementsRouter);
registerDecomposeRoutes(requirementsRouter);
