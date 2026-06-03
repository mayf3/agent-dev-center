import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { authRequired } from '../../middleware/auth.js';
import { internalOnly } from '../../middleware/ip-whitelist.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { env } from '../../config/env.js';
import { agentLoginSchema, agentRegisterSchema, ROLE_PERMISSIONS } from '../../schemas/agent-sso.js';
import { syncAgentToLlmTodo } from '../../utils/agent-sync.js';

interface AgentTokenPayload {
  sub: string;
  name: string;
  role: string;
  permissions: string[];
}

function signAgentToken(payload: AgentTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });
}

export function registerAuthRoutes(router: import('express').Router): void {

// POST /login - Agent 统一登录
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { body } = agentLoginSchema.parse({ body: req.body });

    const user = await prisma.user.findFirst({
      where: { agentId: body.agentId },
      include: { marketplaceAgents: { take: 1 } },
    });

    if (!user) {
      throw new HttpError(404, `Agent "${body.agentId}" 未注册，请先调用 /sso/agent/register`);
    }
    if (!user.enabled) {
      throw new HttpError(401, 'Agent 不存在或已被禁用');
    }

    let tokenValid = false;
    const accessToken = await prisma.agentAccessToken.findFirst({
      where: { agentId: user.marketplaceAgents[0]?.id, token: body.token },
    });
    if (accessToken) {
      if (accessToken.expiresAt && accessToken.expiresAt < new Date()) {
        throw new HttpError(401, 'Agent Token 已过期');
      }
      tokenValid = true;
    }

    if (!tokenValid) {
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

    if (!tokenValid) throw new HttpError(401, 'Agent Token 无效');

    const permissions = (user.permissions as string[]) ?? [];
    const token = signAgentToken({
      sub: user.agentId!,
      name: user.name,
      role: user.role,
      permissions,
    });

    const services = await prisma.service.findMany({
      where: { status: { in: ['online', 'unknown'] } },
      select: { name: true, displayName: true, remoteUrl: true, localUrl: true, status: true },
      orderBy: { displayName: 'asc' },
    });

    res.json({
      accessToken: token,
      user: { id: user.id, agentId: user.agentId, name: user.name, role: user.role, permissions },
      services: services.map((s) => ({
        name: s.name, displayName: s.displayName,
        url: s.remoteUrl ?? s.localUrl ?? null, status: s.status,
      })),
    });
  })
);

// POST /register - Agent 注册
router.post(
  '/register',
  internalOnly,
  authRequired,
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'admin') throw new HttpError(403, '仅管理员可注册 Agent');

    const { body } = agentRegisterSchema.parse({ body: req.body });

    // Dedup by openclawAgentId
    const existingByOpenclawId = await prisma.marketplaceAgent.findFirst({
      where: { openclawAgentId: body.agentId, mergedInto: null },
      include: { owner: true },
    });

    if (existingByOpenclawId) {
      const updated = await prisma.marketplaceAgent.update({
        where: { id: existingByOpenclawId.id },
        data: {
          displayName: body.name,
          registrationSource: 'sso',
          registrationGroup: body.registrationGroup ?? existingByOpenclawId.registrationGroup,
        },
      });

      let user = existingByOpenclawId.owner;
      if (!user) user = await prisma.user.findFirst({ where: { agentId: body.agentId } });
      if (user && user.name !== body.name) {
        await prisma.user.update({ where: { id: user.id }, data: { name: body.name } });
      }

      const existingToken = await prisma.agentAccessToken.findFirst({
        where: { agentId: updated.id, name: 'sso-default' },
      });
      let rawToken = existingToken?.token;
      if (!existingToken) {
        rawToken = `agent_${randomBytes(32).toString('hex')}`;
        await prisma.agentAccessToken.create({ data: { agentId: updated.id, token: rawToken, name: 'sso-default' } });
        await prisma.marketplaceAgent.update({ where: { id: updated.id }, data: { agentToken: rawToken } });
      }

      const permissions = (user?.permissions as string[]) ?? ROLE_PERMISSIONS[body.role]! as unknown as string[];
      const jwtToken = signAgentToken({ sub: body.agentId, name: body.name, role: body.role, permissions });

      res.json({
        message: 'Agent 已注册（复用现有记录）', deduped: true,
        user: { id: user?.id, agentId: body.agentId, name: body.name, role: user?.role ?? body.role, permissions },
        agentToken: rawToken, jwt: jwtToken,
      });
      return;
    }

    // Dedup by user.agentId
    const existingUser = await prisma.user.findFirst({
      where: { agentId: body.agentId },
      include: { marketplaceAgents: { take: 1 } },
    });
    if (existingUser) {
      const existingAgent = existingUser.marketplaceAgents[0];
      if (existingAgent) {
        await prisma.marketplaceAgent.update({
          where: { id: existingAgent.id },
          data: { openclawAgentId: body.agentId, registrationSource: 'sso', registrationGroup: body.registrationGroup },
        });

        const permissions = (existingUser.permissions as string[]) ?? ROLE_PERMISSIONS[body.role]! as unknown as string[];
        const jwtToken = signAgentToken({ sub: body.agentId, name: body.name, role: body.role, permissions });

        const existingToken = await prisma.agentAccessToken.findFirst({
          where: { agentId: existingAgent.id, name: 'sso-default' },
        });
        let rawToken = existingToken?.token;
        if (!existingToken) {
          rawToken = `agent_${randomBytes(32).toString('hex')}`;
          await prisma.agentAccessToken.create({ data: { agentId: existingAgent.id, token: rawToken, name: 'sso-default' } });
          await prisma.marketplaceAgent.update({ where: { id: existingAgent.id }, data: { agentToken: rawToken } });
        }

        res.json({
          message: 'Agent 已注册（关联已有记录）', linked: true,
          user: { id: existingUser.id, agentId: body.agentId, name: body.name, role: existingUser.role, permissions },
          agentToken: rawToken, jwt: jwtToken,
        });
        return;
      }
    }

    // New registration
    const permissions = ROLE_PERMISSIONS[body.role] ?? ROLE_PERMISSIONS['dev-agent']!;
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: `agent:${body.agentId}@sso.agent.dev`,
        password: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
        role: 'agent',
        agentId: body.agentId,
        permissions: permissions as unknown as any[],
      },
    });

    let marketplaceAgent = await prisma.marketplaceAgent.findUnique({ where: { name: body.agentId } });
    if (!marketplaceAgent) {
      marketplaceAgent = await prisma.marketplaceAgent.create({
        data: {
          name: body.agentId, displayName: body.name,
          description: `Auto-registered via SSO (${body.category ?? 'uncategorized'})`,
          capabilities: body.capabilities, ownerId: user.id, userId: user.id,
          openclawAgentId: body.agentId, registrationSource: 'sso',
          registrationGroup: body.registrationGroup,
        },
      });
    } else {
      await prisma.marketplaceAgent.update({
        where: { id: marketplaceAgent.id },
        data: { ownerId: user.id, userId: user.id, openclawAgentId: body.agentId, registrationSource: 'sso', registrationGroup: body.registrationGroup },
      });
    }

    const rawToken = `agent_${randomBytes(32).toString('hex')}`;
    await prisma.agentAccessToken.create({ data: { agentId: marketplaceAgent.id, token: rawToken, name: 'sso-default' } });
    await prisma.marketplaceAgent.update({ where: { id: marketplaceAgent.id }, data: { agentToken: rawToken } });

    const jwtToken = signAgentToken({ sub: body.agentId, name: body.name, role: body.role, permissions });

    res.status(201).json({
      message: 'Agent 注册成功',
      user: { id: user.id, agentId: user.agentId, name: user.name, role: user.role, permissions },
      agentToken: rawToken, jwt: jwtToken,
    });

    void syncAgentToLlmTodo({ agentId: body.agentId, name: body.name, role: body.role, permissions });
  })
);

// GET /verify - 验证 Token
router.get(
  '/verify',
  asyncHandler(async (req, res) => {
    const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) throw new HttpError(401, '请提供 Token');

    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as AgentTokenPayload;
      const user = await prisma.user.findFirst({
        where: { agentId: payload.sub },
        select: { id: true, enabled: true },
      });
      if (!user || !user.enabled) {
        throw new HttpError(401, 'Agent 不存在或已被禁用');
      }

      res.json({
        valid: true,
        agent: { agentId: payload.sub, name: payload.name, role: payload.role, permissions: payload.permissions },
      });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(401, 'Token 无效或已过期');
    }
  })
);

}
