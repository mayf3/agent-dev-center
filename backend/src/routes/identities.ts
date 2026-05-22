import { Router } from "express";
import { authRequired, requireRoles } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";

export const identitiesRouter = Router();

// ─── GET /api/identities — 统一实体列表 ──────────────────────
identitiesRouter.get("/", authRequired, asyncHandler(async (req, res) => {
  const { type, search, pipeline, layer, page = "1", pageSize = "50" } = req.query as Record<string, string>;

  const where: any = {};
  if (type && (type === "human" || type === "agent")) where.type = type;
  if (search) {
    where.displayName = { contains: search, mode: "insensitive" };
  }
  if (pipeline) where.pipeline = pipeline;
  if (layer) where.layer = layer;

  const skip = (Number(page) - 1) * Number(pageSize);
  const [data, total] = await Promise.all([
    prisma.identity.findMany({
      where: where as any,
      skip,
      take: Number(pageSize),
      orderBy: { displayName: "asc" },
    }),
    prisma.identity.count({ where: where as any }),
  ]);

  res.json({
    data,
    meta: { total, page: Number(page), pageSize: Number(pageSize), totalPages: Math.ceil(total / Number(pageSize)) },
  });
}));

// ─── GET /api/identities/:id — 单实体详情 ──────────────────────
identitiesRouter.get("/:id", authRequired, asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const identity = await prisma.identity.findUnique({ where: { id } });
  if (!identity) throw new HttpError(404, "实体不存在");
  res.json({ data: identity });
}));

// ─── PATCH /api/identities/:id — 更新实体 ──────────────────────
identitiesRouter.patch("/:id", authRequired, asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const body = req.body as Record<string, unknown>;

  const identity = await prisma.identity.findUnique({ where: { id } });
  if (!identity) throw new HttpError(404, "实体不存在");

  const data: any = {};
  for (const key of ["displayName","avatar","description","longTermDirection","pipeline","layer","agentType","status"] as const) {
    if (body[key] !== undefined) data[key] = String(body[key]);
  }
  if (body.monthlyGoals !== undefined) data.monthlyGoals = body.monthlyGoals;
  if (body.capabilities !== undefined) data.capabilities = body.capabilities;

  const updated = await prisma.identity.update({ where: { id }, data });

  // ⚠️ 同步双写：如果关联了 AgentGoalCard
  if (updated.agentId && (body.monthlyGoals !== undefined || body.longTermDirection !== undefined)) {
    const goalCard = await prisma.agentGoalCard.findUnique({ where: { agentId: updated.agentId } });
    if (goalCard) {
      const syncData: any = {};
      if (body.monthlyGoals !== undefined) syncData.monthlyGoals = body.monthlyGoals;
      if (body.longTermDirection !== undefined) syncData.longTermDirection = String(body.longTermDirection);

      try {
        await prisma.agentGoalCard.update({ where: { agentId: updated.agentId }, data: syncData });
      } catch {
        await prisma.identity.update({
          where: { id: String(req.params.id) },
          data: { monthlyGoals: identity.monthlyGoals, longTermDirection: identity.longTermDirection } as any,
        });
      }
    }
  }

  res.json({ data: updated });
}));

// ─── GET /api/identities/:id/goals — 实体 OKR 列表 ─────────────
identitiesRouter.get("/:id/goals", authRequired, asyncHandler(async (req, res) => {
  const identity = await prisma.identity.findUnique({ where: { id: String(req.params.id) } });
  if (!identity) throw new HttpError(404, "实体不存在");
  res.json({ data: identity.monthlyGoals });
}));

// ─── PATCH /api/identities/:id/goals — 更新实体 OKR ────────────
identitiesRouter.patch("/:id/goals", authRequired, asyncHandler(async (req, res) => {
  const { monthlyGoals } = req.body as { monthlyGoals?: unknown };
  if (!Array.isArray(monthlyGoals)) {
    throw new HttpError(400, "monthlyGoals 必须是数组");
  }

  const identity = await prisma.identity.findUnique({ where: { id: String(req.params.id) } });
  if (!identity) throw new HttpError(404, "实体不存在");

  const updated = await prisma.identity.update({
    where: { id: String(req.params.id) },
    data: { monthlyGoals } as any,
  });

  // 同步双写到 AgentGoalCard
  if (updated.agentId) {
    const goalCard = await prisma.agentGoalCard.findUnique({ where: { agentId: updated.agentId } });
    if (goalCard) {
      try {
        await prisma.agentGoalCard.update({ where: { agentId: updated.agentId }, data: { monthlyGoals } as any });
      } catch {
        await prisma.identity.update({
          where: { id: String(req.params.id) },
          data: { monthlyGoals: identity.monthlyGoals } as any,
        });
        throw new HttpError(500, "同步到目标卡系统失败，已回滚");
      }
    }
  }

  res.json({ data: updated.monthlyGoals });
}));

// ─── POST /api/identities/sync — 从 User/Agent 同步数据入 Identity ──
identitiesRouter.post("/sync", authRequired, requireRoles("admin"), asyncHandler(async (_req, res) => {
  // 1. 同步 Agent → Identity
  const agents = await prisma.marketplaceAgent.findMany({ include: { goalCard: true } });

  for (const agent of agents) {
    const goalCard = agent.goalCard;
    await prisma.identity.upsert({
      where: { agentId: agent.id },
      create: {
        type: "agent",
        displayName: agent.displayName || agent.name,
        avatar: agent.avatar || "",
        description: agent.description,
        longTermDirection: goalCard?.longTermDirection || "",
        monthlyGoals: (goalCard?.monthlyGoals as any) || [],
        pipeline: (goalCard?.pipeline as any) || "cross_cutting",
        layer: (goalCard?.layer as any) || "mainline",
        agentId: agent.id,
        capabilities: agent.capabilities,
      } as any,
      update: {
        displayName: agent.displayName || agent.name,
        longTermDirection: goalCard?.longTermDirection || "",
        monthlyGoals: (goalCard?.monthlyGoals as any) || [],
        capabilities: agent.capabilities,
      } as any,
    });
  }

  // 2. 同步 User → Identity
  const users = await prisma.user.findMany();
  for (const user of users) {
    await prisma.identity.upsert({
      where: { userId: user.id },
      create: {
        type: "human",
        displayName: user.name,
        description: "",
        longTermDirection: "",
        monthlyGoals: [],
        capabilities: [],
        pipeline: "cross_cutting" as any,
        layer: "mainline" as any,
        userId: user.id,
      } as any,
      update: {
        displayName: user.name,
      } as any,
    });
  }

  res.json({ message: `同步完成: ${agents.length} Agent + ${users.length} Human → Identity 表` });
}));
