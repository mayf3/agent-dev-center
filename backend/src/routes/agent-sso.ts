import { randomBytes } from 'crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { authRequired } from '../middleware/auth.js';
import { agentTokenRequired } from '../middleware/marketplace-auth.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { env } from '../config/env.js';
import {
  agentLoginSchema,
  agentRegisterSchema,
  updateAgentPermissionsSchema,
  syncAgentSchema,
  ROLE_PERMISSIONS,
} from '../schemas/agent-sso.js';
import type { Permission } from '../schemas/agent-sso.js';
import { syncAgentToLlmTodo } from '../utils/agent-sync.js';

export const agentSsoRouter = Router();

// ─── JWT 签发（复用 ADC 的 secret）─────────────────────────

interface AgentTokenPayload {
  sub: string;      // agentId
  name: string;
  role: string;
  permissions: string[];
}

function signAgentToken(payload: AgentTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });
}

// ─── 1. Agent 统一登录 ─────────────────────────────────────

agentSsoRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { body } = agentLoginSchema.parse({ body: req.body });

    // 方式 1: 验证 agent_access_token（新的 agent_xxx token）
    let user = await prisma.user.findFirst({
      where: { agentId: body.agentId },
      include: { marketplaceAgents: { take: 1 } },
    });

    if (!user) {
      throw new HttpError(404, `Agent "${body.agentId}" 未注册，请先调用 /sso/agent/register`);
    }

    // 验证 token
    let tokenValid = false;

    // 检查 agent_access_tokens 表
    const accessToken = await prisma.agentAccessToken.findFirst({
      where: { agentId: user.marketplaceAgents[0]?.id, token: body.token },
    });
    if (accessToken) {
      if (accessToken.expiresAt && accessToken.expiresAt < new Date()) {
        throw new HttpError(401, 'Agent Token 已过期');
      }
      tokenValid = true;
    }

    // 检查旧式 agent token（兼容 llm_todo 的 32 位 hex token）
    if (!tokenValid) {
      // 如果 user 的 agentId 存在，允许旧 token 通过（过渡期）
      const legacyToken = await prisma.agentAccessToken.findFirst({
        where: { token: body.token },
      });
      if (legacyToken) {
        const legacyAgent = await prisma.marketplaceAgent.findUnique({
          where: { id: legacyToken.agentId },
        });
        if (legacyAgent && legacyAgent.name === body.agentId) {
          tokenValid = true;
        }
      }
    }

    if (!tokenValid) {
      throw new HttpError(401, 'Agent Token 无效');
    }

    // 签发统一 JWT
    const permissions = (user.permissions as string[]) ?? [];
    const token = signAgentToken({
      sub: user.agentId!,
      name: user.name,
      role: user.role,
      permissions,
    });

    // 获取可用服务列表
    const services = await prisma.service.findMany({
      where: { status: { in: ['online', 'unknown'] } },
      select: { name: true, displayName: true, remoteUrl: true, localUrl: true, status: true },
      orderBy: { displayName: 'asc' },
    });

    res.json({
      accessToken: token,
      user: {
        id: user.id,
        agentId: user.agentId,
        name: user.name,
        role: user.role,
        permissions,
      },
      services: services.map((s) => ({
        name: s.name,
        displayName: s.displayName,
        url: s.remoteUrl ?? s.localUrl ?? null,
        status: s.status,
      })),
    });
  })
);

// ─── 2. Agent 注册 ──────────────────────────────────────────

agentSsoRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { body } = agentRegisterSchema.parse({ body: req.body });

    // 检查是否已注册
    const existing = await prisma.user.findFirst({
      where: { agentId: body.agentId },
    });
    if (existing) {
      throw new HttpError(409, `Agent "${body.agentId}" 已注册`);
    }

    // 获取角色权限
    const permissions = ROLE_PERMISSIONS[body.role] ?? ROLE_PERMISSIONS['dev-agent']!;

    // 创建 User (role=agent)
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: `agent:${body.agentId}@sso.agent.dev`,
        password: await bcrypt.hash(randomBytes(32).toString('hex'), 10), // 随机密码，Agent 不用密码登录
        role: 'agent',
        agentId: body.agentId,
        permissions: permissions as unknown as any[],
      },
    });

    // 创建 MarketplaceAgent（如果不存在）
    let marketplaceAgent = await prisma.marketplaceAgent.findUnique({
      where: { name: body.agentId },
    });

    if (!marketplaceAgent) {
      marketplaceAgent = await prisma.marketplaceAgent.create({
        data: {
          name: body.agentId,
          displayName: body.name,
          description: `Auto-registered via SSO (${body.category ?? 'uncategorized'})`,
          capabilities: body.capabilities,
          ownerId: user.id,
        },
      });
    }

    // 生成 Agent Access Token
    const rawToken = `agent_${randomBytes(32).toString('hex')}`;
    await prisma.agentAccessToken.create({
      data: {
        agentId: marketplaceAgent.id,
        token: rawToken,
        name: 'sso-default',
      },
    });

    // 更新 marketplaceAgent 的 agentToken 字段
    await prisma.marketplaceAgent.update({
      where: { id: marketplaceAgent.id },
      data: { agentToken: rawToken },
    });

    // 签发统一 JWT
    const jwtToken = signAgentToken({
      sub: body.agentId,
      name: body.name,
      role: body.role,
      permissions,
    });

    res.status(201).json({
      message: 'Agent 注册成功',
      user: {
        id: user.id,
        agentId: user.agentId,
        name: user.name,
        role: user.role,
        permissions,
      },
      agentToken: rawToken,
      jwt: jwtToken,
    });

    // 非阻塞同步到 LLM Todo
    void syncAgentToLlmTodo({
      agentId: body.agentId,
      name: body.name,
      role: body.role,
      permissions,
    });
  })
);

// ─── 3. 列出所有 Agent ──────────────────────────────────────

agentSsoRouter.get(
  '/agents',
  authRequired,
  asyncHandler(async (_req, res) => {
    const agents = await prisma.user.findMany({
      where: { role: 'agent' },
      select: {
        id: true,
        name: true,
        agentId: true,
        permissions: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      data: agents.map((a) => ({
        ...a,
        permissions: a.permissions as string[],
      })),
    });
  })
);

// ─── 4. 更新 Agent 权限 ─────────────────────────────────────

agentSsoRouter.put(
  '/agents/:agentId',
  authRequired,
  asyncHandler(async (req, res) => {
    const { params, body } = updateAgentPermissionsSchema.parse({
      params: req.params,
      body: req.body,
    });

    const user = await prisma.user.findFirst({
      where: { agentId: params.agentId },
    });
    if (!user) throw new HttpError(404, `Agent "${params.agentId}" 不存在`);

    const updateData: Record<string, unknown> = {};
    if (body.permissions) updateData.permissions = body.permissions;
    if (body.name) updateData.name = body.name;

    // 如果更新角色，同时更新 permissions
    if (body.role) {
      const rolePerms = ROLE_PERMISSIONS[body.role];
      if (rolePerms) updateData.permissions = rolePerms;
    }

    if (Object.keys(updateData).length === 0) {
      res.json({ data: user });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
      select: { id: true, name: true, agentId: true, permissions: true },
    });

    res.json({
      data: { ...updated, permissions: updated.permissions as string[] },
    });

    // 同步更新到 LLM Todo
    void syncAgentToLlmTodo({
      agentId: params.agentId,
      name: (updated.name as string),
      role: body.role ?? 'dev-agent',
      permissions: (updated.permissions as string[]),
    });
  })
);

// ─── 5. 验证 Token（供 SP 调用）────────────────────────────

agentSsoRouter.get(
  '/verify',
  asyncHandler(async (req, res) => {
    const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) throw new HttpError(401, '请提供 Token');

    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as AgentTokenPayload;
      res.json({
        valid: true,
        agent: {
          agentId: payload.sub,
          name: payload.name,
          role: payload.role,
          permissions: payload.permissions,
        },
      });
    } catch {
      throw new HttpError(401, 'Token 无效或已过期');
    }
  })
);

// ─── 6. 批量迁移 Agent（内部工具）──────────────────────────

agentSsoRouter.post(
  '/migrate',
  authRequired,
  asyncHandler(async (req, res) => {
    const { agents } = req.body as {
      agents: Array<{
        id: string;
        name: string;
        category: string;
        token: string;
        capabilities: string[];
      }>;
    };

    if (!Array.isArray(agents) || agents.length === 0) {
      throw new HttpError(400, '请提供 agents 数组');
    }

    const results: Array<{ agentId: string; status: string; error?: string }> = [];

    for (const agent of agents) {
      try {
        // 检查是否已存在
        const existing = await prisma.user.findFirst({
          where: { agentId: agent.id },
        });
        if (existing) {
          results.push({ agentId: agent.id, status: 'skipped' });
          continue;
        }

        // 创建 User
        const user = await prisma.user.create({
          data: {
            name: agent.name,
            email: `agent:${agent.id}@sso.agent.dev`,
            password: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
            role: 'agent',
            agentId: agent.id,
            permissions: ROLE_PERMISSIONS['dev-agent']! as unknown as any[],
          },
        });

        // 创建 MarketplaceAgent
        let ma = await prisma.marketplaceAgent.findUnique({
          where: { name: agent.id },
        });
        if (!ma) {
          ma = await prisma.marketplaceAgent.create({
            data: {
              name: agent.id,
              displayName: agent.name,
              description: `Migrated from agents.json (${agent.category})`,
              capabilities: agent.capabilities ?? [],
              ownerId: user.id,
            },
          });
        }

        // 创建 AgentAccessToken（保留原 token 用于兼容）
        await prisma.agentAccessToken.create({
          data: {
            agentId: ma.id,
            token: agent.token,
            name: 'migrated-legacy',
          },
        });

        // 生成新 agent_xxx token
        const newToken = `agent_${randomBytes(32).toString('hex')}`;
        await prisma.agentAccessToken.create({
          data: {
            agentId: ma.id,
            token: newToken,
            name: 'sso-default',
          },
        });

        await prisma.marketplaceAgent.update({
          where: { id: ma.id },
          data: { agentToken: newToken },
        });

        results.push({ agentId: agent.id, status: 'created' });
      } catch (err) {
        results.push({
          agentId: agent.id,
          status: 'error',
          error: (err as Error).message,
        });
      }
    }

    res.json({
      total: agents.length,
      results,
      created: results.filter((r) => r.status === 'created').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      errors: results.filter((r) => r.status === 'error').length,
    });
  })
);
