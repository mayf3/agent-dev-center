import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';

export const familyRouter = Router();

// ─── Mock data for family ────────────────────────────────────

const mockFamily = {
  members: [
    {
      id: 'f001',
      name: '小马哥',
      role: '爸爸',
      age: 35,
      occupation: '技术创业者',
      avatar: null,
    },
    {
      id: 'f002',
      name: '伴侣',
      role: '妈妈',
      age: 33,
      occupation: '设计师',
      avatar: null,
    },
    {
      id: 'f003',
      name: '宝宝',
      role: '孩子',
      age: '7个月',
      avatar: null,
    },
  ],
  familyTree: {
    // Simple family tree structure
    root: 'f001',
    relationships: [
      { from: 'f001', to: 'f002', type: 'spouse' },
      { from: 'f001', to: 'f003', type: 'parent' },
      { from: 'f002', to: 'f003', type: 'parent' },
    ],
  },
};

// ─── GET /api/family ────────────────────────────────────────

familyRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      data: mockFamily,
    });
  })
);
