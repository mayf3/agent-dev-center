import { z } from 'zod';
import { taskStatusValues } from '../utils/status.js';

export const createTaskSchema = z.object({
  body: z.object({
    requirementId: z.string().uuid(),
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().min(2),
    agentType: z
      .enum([
        'game-dev-agent',
        'mobile-app-engineer',
        'miniapp-game-engineer',
        'backend-engineer',
        'frontend-engineer'
      ])
      .or(z.string().trim().min(2).max(80))
  })
});

export const listTasksSchema = z.object({
  query: z.object({
    requirementId: z.string().uuid().optional(),
    status: z.enum(taskStatusValues).optional(),
    agentType: z.string().trim().max(80).optional()
  })
});

export const patchTaskSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  }),
  body: z.object({
    status: z.enum(taskStatusValues)
  })
});

export const deleteTaskSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  })
});
