import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';

export const roadmapRouter = Router();

// ─── Mock data for roadmap ───────────────────────────────────

const mockRoadmap = {
  currentMainLine: '技术产品建设',
  lines: [
    {
      name: '主线 - 技术产品建设',
      milestones: [
        { date: '2026-Q1', title: 'Agent 团队组建', status: 'done', description: '搭建完整的 AI Agent 团队' },
        { date: '2026-Q2', title: '需求平台上线', status: 'done', description: 'Agent Dev Center 平台上线运营' },
        { date: '2026-Q3', title: '学习平台 V2', status: 'in_progress', description: '移动端 + 语音交互学习平台' },
        { date: '2026-Q4', title: '内容管线自动化', status: 'planned', description: '全自动内容生成和分发管线' },
        { date: '2027-Q1', title: '商业化探索', status: 'planned', description: 'AI 服务商业化' },
      ],
    },
    {
      name: '探索线',
      milestones: [
        { date: '2026-Q2', title: '前沿技术追踪', status: 'done', description: '建立前沿观察 Agent 管线' },
        { date: '2026-Q3', title: '开源项目贡献', status: 'in_progress', description: '参与开源社区' },
        { date: '2026-Q4', title: '个人品牌建设', status: 'planned', description: '技术博客和社交媒体' },
      ],
    },
    {
      name: '生活线',
      milestones: [
        { date: '2026-Q2', title: '宝宝成长系统', status: 'done', description: '宝宝日常记录和成长追踪' },
        { date: '2026-Q3', title: '健康管理体系', status: 'in_progress', description: '家庭健康档案和提醒' },
        { date: '2026-Q4', title: '财务规划', status: 'planned', description: '个人财务管理和投资' },
      ],
    },
  ],
};

// ─── GET /api/roadmap ───────────────────────────────────────

roadmapRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      data: mockRoadmap,
    });
  })
);
