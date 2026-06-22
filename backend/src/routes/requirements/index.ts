import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { resolveShortUuid } from '../../middleware/short-uuid.js';
import { registerCoreCrudRoutes } from './core-crud.js';
import { registerCoreKanbanRoutes } from './core-kanban.js';
import { registerCoreLifecycleRoutes } from './core-lifecycle.js';
import { registerAttachmentRoutes } from './attachments.js';
import { registerStatusRoutes } from './status.js';
import { registerReviewRoutes } from './review.js';
import { registerPipelineRoutes } from './pipeline.js';
import { registerDecomposeRoutes } from './decompose.js';
import { registerWorkflowAdvanceRoutes } from './workflow-advance.js';
import { registerWorkflowSubmitRoutes } from './workflow-submit.js';
import { registerWorkflowRejectRoutes } from './workflow-reject.js';
import { registerWorkflowAssignRoutes } from './workflow-assign.js';
import { registerWorkflowTemplateRoutes } from './workflow-templates.js';
import { registerWorkflowMyStepRoutes } from './workflow-mystep.js';
import { registerDependencyGraphRoutes } from './dependency-graph.js';
import { registerTransitionRoutes } from './transitions.js';

export const requirementsRouter = Router();

// 所有需求路由都需要登录认证
requirementsRouter.use(authRequired);

// 短 UUID 前缀匹配 — 在路由解析前将短 ID 扩展为完整 UUID
requirementsRouter.use(resolveShortUuid);

// 注册工作流路由（必须在 core CRUD 之前，避免 /:id 参数路由冲突）
registerWorkflowTemplateRoutes(requirementsRouter);
registerWorkflowSubmitRoutes(requirementsRouter);
registerWorkflowAdvanceRoutes(requirementsRouter);
registerWorkflowRejectRoutes(requirementsRouter);
registerWorkflowAssignRoutes(requirementsRouter);
registerWorkflowMyStepRoutes(requirementsRouter);

// 注册 core 路由（拆分为三个模块）
registerCoreKanbanRoutes(requirementsRouter);
registerCoreCrudRoutes(requirementsRouter);
registerCoreLifecycleRoutes(requirementsRouter);

// 注册其他模块路由
registerAttachmentRoutes(requirementsRouter);
registerStatusRoutes(requirementsRouter);
registerReviewRoutes(requirementsRouter);
registerPipelineRoutes(requirementsRouter);
registerDecomposeRoutes(requirementsRouter);
registerDependencyGraphRoutes(requirementsRouter);
registerTransitionRoutes(requirementsRouter);
export const router = requirementsRouter;
export const mountPath = '/api/requirements';
