import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { authRequired } from '../../middleware/auth.js';
import { internalOnly } from '../../middleware/ip-whitelist.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { updateAgentPermissionsSchema, ROLE_PERMISSIONS } from '../../schemas/agent-sso.js';
import { syncAgentToLlmTodo } from '../../utils/agent-sync.js';

export function registerAdminRoutes(router: import('express').Router): void {

// GET /agents - 列出所有 Agent
router.get(
  '/agents',
  authRequired,
  asyncHandler(async (_req, res) => {
    const agents = await prisma.user.findMany({
      where: { role: 'agent' },
      select: { id: true, name: true, agentId: true, permissions: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: agents.map((a) => ({ ...a, permissions: a.permissions as string[] })) });
  })
);

// PUT /agents/:agentId - 更新 Agent 权限
router.put(
  '/agents/:agentId',
  authRequired,
  asyncHandler(async (req, res) => {
    const { params, body } = updateAgentPermissionsSchema.parse({ params: req.params, body: req.body });

    const user = await prisma.user.findFirst({ where: { agentId: params.agentId } });
    if (!user) throw new HttpError(404, `Agent "${params.agentId}" 不存在`);

    const updateData: Record<string, unknown> = {};
    if (body.permissions) updateData.permissions = body.permissions;
    if (body.name) updateData.name = body.name;
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

    res.json({ data: { ...updated, permissions: updated.permissions as string[] } });

    void syncAgentToLlmTodo({
      agentId: params.agentId,
      name: (updated.name as string),
      role: body.role ?? 'dev-agent',
      permissions: (updated.permissions as string[]),
    });
  })
);

// POST /migrate - 批量迁移 Agent
router.post(
  '/migrate',
  authRequired,
  asyncHandler(async (req, res) => {
    const { agents } = req.body as {
      agents: Array<{ id: string; name: string; category: string; token: string; capabilities: string[] }>;
    };

    if (!Array.isArray(agents) || agents.length === 0) throw new HttpError(400, '请提供 agents 数组');

    const results: Array<{ agentId: string; status: string; error?: string }> = [];

    for (const agent of agents) {
      try {
        const existing = await prisma.user.findFirst({ where: { agentId: agent.id } });
        if (existing) {
          results.push({ agentId: agent.id, status: 'skipped' });
          continue;
        }

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

        let ma = await prisma.marketplaceAgent.findUnique({ where: { name: agent.id } });
        if (!ma) {
          ma = await prisma.marketplaceAgent.create({
            data: {
              name: agent.id, displayName: agent.name,
              description: `Migrated from agents.json (${agent.category})`,
              capabilities: agent.capabilities ?? [], ownerId: user.id,
            },
          });
        }

        await prisma.agentAccessToken.create({ data: { agentId: ma.id, token: agent.token, name: 'migrated-legacy' } });

        const newToken = `agent_${randomBytes(32).toString('hex')}`;
        await prisma.agentAccessToken.create({ data: { agentId: ma.id, token: newToken, name: 'sso-default' } });
        await prisma.marketplaceAgent.update({ where: { id: ma.id }, data: { agentToken: newToken } });

        results.push({ agentId: agent.id, status: 'created' });
      } catch (err) {
        results.push({ agentId: agent.id, status: 'error', error: (err as Error).message });
      }
    }

    res.json({
      total: agents.length, results,
      created: results.filter((r) => r.status === 'created').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      errors: results.filter((r) => r.status === 'error').length,
    });
  })
);

// POST /merge - 合并重复 Agent
const mergeSchema = z.object({
  body: z.object({
    survivorId: z.string().uuid(),
    duplicateIds: z.array(z.string().uuid()).min(1),
    openclawAgentId: z.string().optional(),
  }),
});

router.post(
  '/merge',
  internalOnly,
  authRequired,
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'admin') throw new HttpError(403, '仅管理员可执行合并');

    const { body } = mergeSchema.parse({ body: req.body });
    const { survivorId, duplicateIds, openclawAgentId } = body;

    const survivor = await prisma.marketplaceAgent.findUnique({ where: { id: survivorId } });
    if (!survivor) throw new HttpError(404, '目标 Agent 不存在');
    if (duplicateIds.includes(survivorId)) throw new HttpError(400, '不能将自己合并到自己');

    const results: Array<{ id: string; status: string; details: string }> = [];

    for (const dupId of duplicateIds) {
      try {
        const dup = await prisma.marketplaceAgent.findUnique({ where: { id: dupId } });
        if (!dup) {
          results.push({ id: dupId, status: 'not_found', details: 'Agent 不存在' });
          continue;
        }

        const goalCard = await prisma.agentGoalCard.findUnique({ where: { agentId: dupId } });
        if (goalCard) {
          const existingGC = await prisma.agentGoalCard.findUnique({ where: { agentId: survivorId } });
          if (!existingGC) {
            await prisma.agentGoalCard.update({ where: { agentId: dupId }, data: { agentId: survivorId } });
          } else {
            await prisma.agentGoalCard.delete({ where: { agentId: dupId } });
          }
        }

        await prisma.goalRevision.updateMany({ where: { goalCardId: dupId }, data: { goalCardId: survivorId } });
        await prisma.marketplaceTask.updateMany({ where: { agentId: dupId }, data: { agentId: survivorId } });
        await prisma.agentAccessToken.updateMany({ where: { agentId: dupId }, data: { agentId: survivorId } });
        await prisma.weeklyReport.updateMany({ where: { agentId: dupId }, data: { agentId: survivorId } });

        if (!survivor.ownerId && dup.ownerId) {
          await prisma.marketplaceAgent.update({ where: { id: survivorId }, data: { ownerId: dup.ownerId } });
        }

        const survCaps = (survivor.capabilities as string[]) ?? [];
        const dupCaps = (dup.capabilities as string[]) ?? [];
        const mergedCaps = [...new Set([...survCaps, ...dupCaps])];
        if (mergedCaps.length > survCaps.length) {
          await prisma.marketplaceAgent.update({ where: { id: survivorId }, data: { capabilities: mergedCaps as any } });
        }

        await prisma.marketplaceAgent.update({
          where: { id: dupId },
          data: { mergedInto: survivorId, mergedAt: new Date(), status: 'inactive' },
        });

        await prisma.user.updateMany({
          where: { agentId: dup.name },
          data: { agentId: openclawAgentId ?? survivor.name },
        });

        results.push({
          id: dupId, status: 'merged',
          details: `goalCard=${goalCard ? 'moved' : 'none'}`,
        });
      } catch (err) {
        results.push({ id: dupId, status: 'error', details: (err as Error).message });
      }
    }

    if (openclawAgentId) {
      await prisma.marketplaceAgent.update({
        where: { id: survivorId },
        data: { openclawAgentId, registrationSource: 'merged' },
      });
    }

    res.json({
      message: `合并完成: ${results.filter((r) => r.status === 'merged').length} 个 Agent 已合并到 ${survivor.displayName}`,
      survivor: { id: survivorId, name: survivor.name, displayName: survivor.displayName, openclawAgentId: openclawAgentId ?? survivor.openclawAgentId },
      results,
    });
  })
);

// GET /duplicates - 列出重复 Agent
router.get(
  '/duplicates',
  authRequired,
  asyncHandler(async (_req, res) => {
    const merged = await prisma.marketplaceAgent.findMany({
      where: { mergedInto: { not: null } },
      select: { id: true, name: true, displayName: true, mergedInto: true, mergedAt: true, openclawAgentId: true },
    });

    const agents = await prisma.marketplaceAgent.findMany({
      where: { mergedInto: null, status: 'active' },
      select: { id: true, name: true, displayName: true, openclawAgentId: true, ownerId: true, registrationSource: true },
      orderBy: { name: 'asc' },
    });

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

    res.json({ merged, potentialDuplicates, totalActive: agents.length });
  })
);

}
