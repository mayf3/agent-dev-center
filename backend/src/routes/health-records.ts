import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';

export const healthRecordsRouter = Router();

// ─── Mock data for health records ────────────────────────────

const mockHealthRecords = {
  members: [
    {
      name: '小马哥',
      records: [
        { date: '2026-04', weight: '75kg', height: '178cm', bloodPressure: '120/80', note: '正常' },
        { date: '2026-05', weight: '74kg', height: '178cm', bloodPressure: '118/78', note: '略有下降' },
      ],
      allergies: ['花粉'],
    },
    {
      name: '宝宝',
      records: [
        { date: '2026-04', age: '6个月', weight: '8.5kg', height: '68cm', note: '发育正常' },
        { date: '2026-05', age: '7个月', weight: '8.9kg', height: '70cm', note: '开始爬行' },
      ],
      allergies: [],
    },
    {
      name: '伴侣',
      records: [
        { date: '2026-04', note: '体检正常' },
        { date: '2026-05', note: '正常' },
      ],
    },
  ],
};

// ─── GET /api/health-records ─────────────────────────────────

healthRecordsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      data: mockHealthRecords,
    });
  })
);
export const router = healthRecordsRouter;
export const mountPath = '/api/health-records';
