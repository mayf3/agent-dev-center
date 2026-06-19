import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { registerCoreCreateRoutes } from './core-create.js';
import { registerCoreListRoutes } from './core-list.js';
import { registerCorePutRoutes } from './core-put.js';
import { registerCorePatchRoutes } from './core-patch.js';
import { registerCoreKanbanRoutes } from './core-kanban.js';
import { registerCoreMineRoutes } from './core-mine.js';
import { registerCoreLifecycleRoutes } from './core-lifecycle.js';
import { registerAttachmentRoutes } from './attachments.js';
import { registerStatusRoutes } from './status.js';
import { registerReviewRoutes } from './review.js';
import { registerPipelineRoutes } from './pipeline.js';
import { registerDecomposeRoutes } from './decompose.js';
import { registerWorkflowAdvanceRoutes } from './workflow-advance.js';
import { registerWorkflowRejectRoutes } from './workflow-reject.js';
import { registerWorkflowAssignRoutes } from './workflow-assign.js';
import { registerWorkflowLifecycleRoutes } from './workflow-lifecycle.js';
import { registerWorkflowTestEnvRoutes } from './workflow-test-env.js';
import { registerWorkflowTemplatesListRoutes } from './workflow-templates-list.js';
import { registerWorkflowWipRoutes } from './workflow-wip.js';
import { registerWorkflowStepConfigRoutes } from './workflow-step-config.js';
import { registerWorkflowMyStepRoutes } from './workflow-mystep.js';
import { registerDependencyGraphRoutes } from './dependency-graph.js';
import { registerTransitionRoutes } from './transitions.js';
import { registerExecutionLeaseRoutes } from './execution-lease.js';
import { reportsRouter } from '../reports.js';

export const requirementsRouter = Router();

// All requirement routes require authentication
requirementsRouter.use(authRequired);

// Register workflow routes (must be before core CRUD to avoid /:id param conflicts)
registerWorkflowTestEnvRoutes(requirementsRouter);
registerWorkflowTemplatesListRoutes(requirementsRouter);
registerWorkflowWipRoutes(requirementsRouter);
registerWorkflowStepConfigRoutes(requirementsRouter);
registerWorkflowAdvanceRoutes(requirementsRouter);
registerWorkflowRejectRoutes(requirementsRouter);
registerWorkflowAssignRoutes(requirementsRouter);
registerWorkflowLifecycleRoutes(requirementsRouter);
registerWorkflowMyStepRoutes(requirementsRouter);

// Register core routes
registerCoreKanbanRoutes(requirementsRouter);
registerCoreMineRoutes(requirementsRouter);
registerCoreCreateRoutes(requirementsRouter);
registerCoreListRoutes(requirementsRouter);
registerCorePutRoutes(requirementsRouter);
registerCorePatchRoutes(requirementsRouter);
registerCoreLifecycleRoutes(requirementsRouter);

// Register other module routes
registerAttachmentRoutes(requirementsRouter);
registerStatusRoutes(requirementsRouter);
registerReviewRoutes(requirementsRouter);
registerPipelineRoutes(requirementsRouter);
registerDecomposeRoutes(requirementsRouter);
registerDependencyGraphRoutes(requirementsRouter);
registerTransitionRoutes(requirementsRouter);
registerExecutionLeaseRoutes(requirementsRouter);

// Mount reports router
requirementsRouter.use('/:id/reports', reportsRouter);

export const router = requirementsRouter;
export const mountPath = '/api/requirements';
