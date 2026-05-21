import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';

export const skillTreeRouter = Router();

// ─── Mock data for skill tree ────────────────────────────────

const mockSkillTree = {
  categories: [
    {
      name: '技术能力',
      skills: [
        { name: '前端开发', level: 4, maxLevel: 5, subSkills: ['React/Vue', 'CSS/HTML', 'TypeScript'] },
        { name: '后端开发', level: 3, maxLevel: 5, subSkills: ['Node.js', 'Python', 'API设计'] },
        { name: 'AI/ML', level: 3, maxLevel: 5, subSkills: ['LLM应用', '提示工程', 'Agent开发'] },
        { name: 'DevOps', level: 2, maxLevel: 5, subSkills: ['Docker', 'CI/CD', 'Linux'] },
      ],
    },
    {
      name: '内容创作',
      skills: [
        { name: '技术写作', level: 4, maxLevel: 5 },
        { name: '英文写作', level: 3, maxLevel: 5 },
        { name: '视频制作', level: 2, maxLevel: 5 },
      ],
    },
    {
      name: '管理能力',
      skills: [
        { name: '团队管理', level: 3, maxLevel: 5 },
        { name: '项目管理', level: 3, maxLevel: 5 },
        { name: '产品设计', level: 2, maxLevel: 5 },
      ],
    },
    {
      name: '生活能力',
      skills: [
        { name: '财务管理', level: 2, maxLevel: 5 },
        { name: '健康管理', level: 2, maxLevel: 5 },
        { name: '育儿', level: 2, maxLevel: 5 },
      ],
    },
  ],
};

// ─── GET /api/skill-tree ────────────────────────────────────

skillTreeRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      data: mockSkillTree,
    });
  })
);
