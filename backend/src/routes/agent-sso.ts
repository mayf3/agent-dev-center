import { randomBytes } from 'crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { authRequired } from '../middleware/auth.js';
import { agentTokenRequired } from '../middleware/marketplace-auth.js';
import { internalOnly } from '../middleware/ip-whitelist.js';
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
  internalOnly,
  authRequired,
  asyncHandler(async (req, res) => {
    // 仅 admin 可注册 Agent
    if (req.user!.role !== 'admin') {
      throw new HttpError(403, '仅管理员可注册 Agent');
    }

    const { body } = agentRegisterSchema.parse({ body: req.body });

    // ──── Dedup: check by openclawAgentId first ────
    // If any marketplace_agent already has openclawAgentId = body.agentId, reuse it
    const existingByOpenclawId = await prisma.marketplaceAgent.findFirst({
      where: { openclawAgentId: body.agentId, mergedInto: null },
      include: { owner: true },
    });

    if (existingByOpenclawId) {
      // Already registered — update info if needed, return existing
      const updated = await prisma.marketplaceAgent.update({
        where: { id: existingByOpenclawId.id },
        data: {
          displayName: body.name,
          registrationSource: 'sso',
          registrationGroup: body.registrationGroup ?? existingByOpenclawId.registrationGroup,
        },
      });

      // Ensure user exists
      let user = existingByOpenclawId.owner;
      if (!user) {
        user = await prisma.user.findFirst({
          where: { agentId: body.agentId },
        });
      }

      // Update user name if changed
      if (user && user.name !== body.name) {
        await prisma.user.update({
          where: { id: user.id },
          data: { name: body.name },
        });
      }

      // Ensure access token exists
      const existingToken = await prisma.agentAccessToken.findFirst({
        where: { agentId: updated.id, name: 'sso-default' },
      });

      let rawToken = existingToken?.token;
      if (!existingToken) {
        rawToken = `agent_${randomBytes(32).toString('hex')}`;
        await prisma.agentAccessToken.create({
          data: { agentId: updated.id, token: rawToken, name: 'sso-default' },
        });
        await prisma.marketplaceAgent.update({
          where: { id: updated.id },
          data: { agentToken: rawToken },
        });
      }

      const permissions = (user?.permissions as string[]) ?? ROLE_PERMISSIONS[body.role]! as unknown as string[];
      const jwtToken = signAgentToken({
        sub: body.agentId,
        name: body.name,
        role: body.role,
        permissions,
      });

      res.json({
        message: 'Agent 已注册（复用现有记录）',
        deduped: true,
        user: {
          id: user?.id,
          agentId: body.agentId,
          name: body.name,
          role: user?.role ?? body.role,
          permissions,
        },
        agentToken: rawToken,
        jwt: jwtToken,
      });
      return;
    }

    // ──── Check user-level dedup (agentId on users table) ────
    const existingUser = await prisma.user.findFirst({
      where: { agentId: body.agentId },
      include: { marketplaceAgents: { take: 1 } },
    });
    if (existingUser) {
      // User exists but no openclawAgentId mapping — link existing agent
      const existingAgent = existingUser.marketplaceAgents[0];
      if (existingAgent) {
        // Add openclawAgentId to existing agent
        await prisma.marketplaceAgent.update({
          where: { id: existingAgent.id },
          data: {
            openclawAgentId: body.agentId,
            registrationSource: 'sso',
            registrationGroup: body.registrationGroup,
          },
        });

        const permissions = (existingUser.permissions as string[]) ?? ROLE_PERMISSIONS[body.role]! as unknown as string[];
        const jwtToken = signAgentToken({
          sub: body.agentId,
          name: body.name,
          role: body.role,
          permissions,
        });

        // Ensure access token
        const existingToken = await prisma.agentAccessToken.findFirst({
          where: { agentId: existingAgent.id, name: 'sso-default' },
        });
        let rawToken = existingToken?.token;
        if (!existingToken) {
          rawToken = `agent_${randomBytes(32).toString('hex')}`;
          await prisma.agentAccessToken.create({
            data: { agentId: existingAgent.id, token: rawToken, name: 'sso-default' },
          });
          await prisma.marketplaceAgent.update({
            where: { id: existingAgent.id },
            data: { agentToken: rawToken },
          });
        }

        res.json({
          message: 'Agent 已注册（关联已有记录）',
          linked: true,
          user: {
            id: existingUser.id,
            agentId: body.agentId,
            name: body.name,
            role: existingUser.role,
            permissions,
          },
          agentToken: rawToken,
          jwt: jwtToken,
        });
        return;
      }
    }

    // ──── New registration ────

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
          openclawAgentId: body.agentId,
          registrationSource: 'sso',
          registrationGroup: body.registrationGroup,
        },
      });
    } else {
      // Agent exists by name — link it with openclawAgentId
      await prisma.marketplaceAgent.update({
        where: { id: marketplaceAgent.id },
        data: {
          ownerId: user.id,
          openclawAgentId: body.agentId,
          registrationSource: 'sso',
          registrationGroup: body.registrationGroup,
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

// ─── 7. Merge duplicate agents (admin only) ──────────────

import { z as zod } from 'zod';

const mergeSchema = zod.object({
  body: zod.object({
    survivorId: zod.string().uuid(),     // the agent that survives
    duplicateIds: zod.array(zod.string().uuid()).min(1), // agents to merge into survivor
    openclawAgentId: zod.string().optional(), // set the OpenClaw agentId on survivor
  }),
});

agentSsoRouter.post(
  '/merge',
  internalOnly,
  authRequired,
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'admin') {
      throw new HttpError(403, '仅管理员可执行合并');
    }

    const { body } = mergeSchema.parse({ body: req.body });
    const { survivorId, duplicateIds, openclawAgentId } = body;

    // Verify survivor exists
    const survivor = await prisma.marketplaceAgent.findUnique({
      where: { id: survivorId },
    });
    if (!survivor) throw new HttpError(404, '目标 Agent 不存在');

    // Prevent merging self
    if (duplicateIds.includes(survivorId)) {
      throw new HttpError(400, '不能将自己合并到自己');
    }

    const results: Array<{ id: string; status: string; details: string }> = [];

    for (const dupId of duplicateIds) {
      try {
        const dup = await prisma.marketplaceAgent.findUnique({ where: { id: dupId } });
        if (!dup) {
          results.push({ id: dupId, status: 'not_found', details: 'Agent 不存在' });
          continue;
        }

        // 1. Move goal card
        const goalCard = await prisma.agentGoalCard.findUnique({
          where: { agentId: dupId },
        });
        if (goalCard) {
          // Check if survivor already has a goal card
          const existingGC = await prisma.agentGoalCard.findUnique({
            where: { agentId: survivorId },
          });
          if (!existingGC) {
            await prisma.agentGoalCard.update({
              where: { agentId: dupId },
              data: { agentId: survivorId },
            });
          }
          // If both have goal cards, keep survivor's and just delete duplicate's
          else {
            await prisma.agentGoalCard.delete({ where: { agentId: dupId } });
          }
        }

        // 2. Move goal revisions
        const revisionsResult = await prisma.goalRevision.updateMany({
          where: { goalCardId: dupId },
          data: { goalCardId: survivorId },
        });

        // 3. Move marketplace tasks
        const tasksMoved = await prisma.marketplaceTask.updateMany({
          where: { agentId: dupId },
          data: { agentId: survivorId },
        });

        // 4. Move access tokens
        const tokensMoved = await prisma.agentAccessToken.updateMany({
          where: { agentId: dupId },
          data: { agentId: survivorId },
        });

        // 5. Move weekly reports
        const reportsMoved = await prisma.weeklyReport.updateMany({
          where: { agentId: dupId },
          data: { agentId: survivorId },
        });

        // 6. Move owner if survivor has none
        if (!survivor.ownerId && dup.ownerId) {
          await prisma.marketplaceAgent.update({
            where: { id: survivorId },
            data: { ownerId: dup.ownerId },
          });
        }

        // 7. Merge capabilities
        const survCaps = (survivor.capabilities as string[]) ?? [];
        const dupCaps = (dup.capabilities as string[]) ?? [];
        const mergedCaps = [...new Set([...survCaps, ...dupCaps])];
        if (mergedCaps.length > survCaps.length) {
          await prisma.marketplaceAgent.update({
            where: { id: survivorId },
            data: { capabilities: mergedCaps as any },
          });
        }

        // 8. Mark duplicate as merged
        await prisma.marketplaceAgent.update({
          where: { id: dupId },
          data: {
            mergedInto: survivorId,
            mergedAt: new Date(),
            status: 'inactive',
          },
        });

        // 9. Update duplicate's user (if any) to point to survivor
        await prisma.user.updateMany({
          where: { agentId: dup.name },
          data: { agentId: openclawAgentId ?? survivor.name },
        });

        results.push({
          id: dupId,
          status: 'merged',
          details: `goalCard=${goalCard ? 'moved' : 'none'}, tasks=${tasksMoved.count}, tokens=${tokensMoved.count}, reports=${reportsMoved.count}`,
        });
      } catch (err) {
        results.push({
          id: dupId,
          status: 'error',
          details: (err as Error).message,
        });
      }
    }

    // Update survivor with openclawAgentId if provided
    if (openclawAgentId) {
      await prisma.marketplaceAgent.update({
        where: { id: survivorId },
        data: {
          openclawAgentId,
          registrationSource: 'merged',
        },
      });
    }

    res.json({
      message: `合并完成: ${results.filter((r) => r.status === 'merged').length} 个 Agent 已合并到 ${survivor.displayName}`,
      survivor: {
        id: survivorId,
        name: survivor.name,
        displayName: survivor.displayName,
        openclawAgentId: openclawAgentId ?? survivor.openclawAgentId,
      },
      results,
    });
  })
);

// ─── 8. List duplicate agents ─────────────────────────────

agentSsoRouter.get(
  '/duplicates',
  authRequired,
  asyncHandler(async (_req, res) => {
    // Find marketplace_agents that might be duplicates:
    // Same owner, similar displayName, or with mergedInto set
    const merged = await prisma.marketplaceAgent.findMany({
      where: { mergedInto: { not: null } },
      select: {
        id: true,
        name: true,
        displayName: true,
        mergedInto: true,
        mergedAt: true,
        openclawAgentId: true,
      },
    });

    // Find potential duplicates: same openclawAgentId or similar names
    // Group by ownerId where owner has multiple agents
    const agents = await prisma.marketplaceAgent.findMany({
      where: { mergedInto: null, status: 'active' },
      select: {
        id: true,
        name: true,
        displayName: true,
        openclawAgentId: true,
        ownerId: true,
        registrationSource: true,
      },
      orderBy: { name: 'asc' },
    });

    // Group by ownerId to find potential duplicates
    const byOwner = new Map<string, typeof agents>();
    for (const a of agents) {
      if (!a.ownerId) continue;
      const list = byOwner.get(a.ownerId) ?? [];
      list.push(a);
      byOwner.set(a.ownerId, list);
    }

    const potentialDuplicates = Array.from(byOwner.entries())
      .filter(([, list]) => list.length > 1)
      .map(([ownerId, list]) => ({ ownerId, agents: list }));

    res.json({
      merged,
      potentialDuplicates,
      totalActive: agents.length,
    });
  })
);
