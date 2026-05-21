import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';

export const profileRouter = Router();

// ─── Mock data for personal profile ──────────────────────────

const mockProfile = {
  id: 'p001',
  name: '小马哥',
  bio: '技术创业者，AI 爱好者，终身学习者',
  longTermGoals: [
    { text: '建成自主运转的 AI Agent 团队', timeline: '2026-2027' },
    { text: '打造个人知识管理系统', timeline: '2026' },
    { text: '实现多语言内容创作管线', timeline: '2026-2027' },
  ],
  annualPlans: [
    { year: 2026, goals: ['AI Agent 团队自动化', '学习平台上线', '内容管线稳定运转'] },
  ],
  contact: {
    email: 'xiaomage@example.com',
    github: 'xiaomage',
  },
};

// ─── GET /api/profile ───────────────────────────────────────

profileRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      data: mockProfile,
    });
  })
);
