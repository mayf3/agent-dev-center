import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { registerCoreRoutes } from './core.js';
import { registerAttachmentRoutes } from './attachments.js';
import { registerStatusRoutes } from './status.js';
import { registerReviewRoutes } from './review.js';
import { registerPipelineRoutes } from './pipeline.js';
import { registerDecomposeRoutes } from './decompose.js';
import { registerWorkflowRoutes } from './workflow.js';

export const requirementsRouter = Router();

// 所有需求路由都需要登录认证
requirementsRouter.use(authRequired);

// 注册各模块路由
registerWorkflowRoutes(requirementsRouter);
registerCoreRoutes(requirementsRouter);
registerAttachmentRoutes(requirementsRouter);
registerStatusRoutes(requirementsRouter);
registerReviewRoutes(requirementsRouter);
registerPipelineRoutes(requirementsRouter);
registerDecomposeRoutes(requirementsRouter);
