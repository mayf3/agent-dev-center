import { asyncHandler } from '../../utils/async-handler.js';

export function registerPipelineRoutes(router: import('express').Router): void {

// 流水线相关路由占位
// TODO: 后续添加 start-pipeline, confirm-start, by-pipeline 等路由
router.get(
  '/pipeline/status',
  asyncHandler(async (_req, res) => {
    res.json({ message: 'Pipeline endpoints coming soon' });
  })
);

}
