import { z } from 'zod';

// Agent 登录
export const agentLoginSchema = z.object({
  body: z.object({
    agentId: z.string().trim().min(1),
    token: z.string().trim().min(1),
  }),
});

// Agent 注册
export const agentRegisterSchema = z.object({
  body: z.object({
    agentId: z.string().trim().min(2).max(80),
    name: z.string().trim().min(2).max(120),
    category: z.string().trim().optional(),
    role: z.enum(['admin-agent', 'manager-agent', 'dev-agent', 'viewer-agent']).default('dev-agent'),
    capabilities: z.array(z.string()).default([]),
  }),
});

// 更新 Agent 权限
export const updateAgentPermissionsSchema = z.object({
  params: z.object({ agentId: z.string().trim().min(1) }),
  body: z.object({
    permissions: z.array(z.string()).optional(),
    role: z.enum(['admin-agent', 'manager-agent', 'dev-agent', 'viewer-agent']).optional(),
    name: z.string().trim().min(2).max(120).optional(),
  }),
});

// 同步 Agent 到目标平台
export const syncAgentSchema = z.object({
  params: z.object({ target: z.enum(['llm-todo']) }),
  body: z.object({
    agentId: z.string().trim().min(1).optional(), // 不传则同步全部
  }),
});

// 权限常量
export const PERMISSIONS = [
  'todo:read',
  'todo:write',
  'requirement:read',
  'requirement:write',
  'requirement:approve',
  'marketplace:read',
  'marketplace:write',
  'marketplace:claim',
  'admin',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// 角色默认权限
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  'admin-agent': ['admin'],
  'manager-agent': ['todo:read', 'todo:write', 'requirement:read', 'requirement:write', 'marketplace:read', 'marketplace:write'],
  'dev-agent': ['todo:read', 'todo:write', 'requirement:read', 'marketplace:read', 'marketplace:claim'],
  'viewer-agent': ['todo:read', 'requirement:read', 'marketplace:read'],
};
