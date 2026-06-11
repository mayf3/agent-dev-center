import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import {
  agentPerformanceSchema,
  createCustomerSchema,
  createOrderSchema,
  createRevenueRecordSchema,
  customerIdSchema,
  listCustomersSchema,
  listOrdersSchema,
  orderIdSchema,
  revenueRecordIdSchema,
  revenueSummarySchema,
  updateCustomerSchema,
  updateOrderSchema,
  updateRevenueRecordSchema,
} from '../schemas/operations.js';

export const operationsRouter = Router();

operationsRouter.use(authRequired);

const orderInclude = {
  customer: true,
  revenues: { orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.OrderInclude;

const customerDetailInclude = {
  orders: {
    include: {
      revenues: { orderBy: { createdAt: 'desc' as const } },
    },
    orderBy: { createdAt: 'desc' as const },
  },
  _count: { select: { orders: true } },
} satisfies Prisma.CustomerInclude;

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function decimalToNumber(value: Prisma.Decimal | null | undefined): number {
  if (!value) return 0;
  return Number(value.toString());
}

function monthRange(monthFrom?: string, monthTo?: string): Prisma.StringNullableFilter | undefined {
  if (!monthFrom && !monthTo) return undefined;
  return {
    ...(monthFrom ? { gte: monthFrom } : {}),
    ...(monthTo ? { lte: monthTo } : {}),
  };
}

function createdAtRange(monthFrom?: string, monthTo?: string): Prisma.DateTimeFilter | undefined {
  if (!monthFrom && !monthTo) return undefined;
  const range: Prisma.DateTimeFilter = {};
  if (monthFrom) range.gte = new Date(`${monthFrom}-01T00:00:00.000Z`);
  if (monthTo) {
    const [year, month] = monthTo.split('-').map(Number);
    range.lt = new Date(Date.UTC(year, month, 1));
  }
  return range;
}

async function getAgentMap(agentIds: Array<string | null | undefined>) {
  const ids = Array.from(new Set(agentIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return new Map<string, { id: string; name: string; displayName: string; avatar: string | null; status: string }>();

  const agents = await prisma.marketplaceAgent.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, displayName: true, avatar: true, status: true },
  });

  return new Map(agents.map((agent) => [agent.id, agent]));
}

function agentPayload(agentId: string | null, agentMap: Awaited<ReturnType<typeof getAgentMap>>) {
  if (!agentId) {
    return { id: null, name: 'unassigned', displayName: '未分配 Agent', avatar: null, status: 'unknown' };
  }

  const agent = agentMap.get(agentId);
  return agent ?? { id: agentId, name: agentId, displayName: '未知 Agent', avatar: null, status: 'unknown' };
}

// ─── Customers ────────────────────────────────────────────────

operationsRouter.get(
  '/customers',
  asyncHandler(async (req, res) => {
    const { query } = listCustomersSchema.parse({ query: req.query });
    const where: Prisma.CustomerWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.source) where.source = { contains: query.source, mode: 'insensitive' };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        { source: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.customer.findMany({
        where,
        include: { _count: { select: { orders: true } } },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.customer.count({ where }),
    ]);

    res.json({
      data: items,
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    });
  })
);

operationsRouter.post(
  '/customers',
  asyncHandler(async (req, res) => {
    const { body } = createCustomerSchema.parse({ body: req.body });
    const customer = await prisma.customer.create({
      data: body,
      include: { _count: { select: { orders: true } } },
    });
    res.status(201).json({ data: customer });
  })
);

operationsRouter.get(
  '/customers/:id',
  asyncHandler(async (req, res) => {
    const { params } = customerIdSchema.parse({ params: req.params });
    const customer = await prisma.customer.findUnique({
      where: { id: params.id },
      include: customerDetailInclude,
    });

    if (!customer) throw new HttpError(404, '客户不存在');
    res.json({ data: customer });
  })
);

operationsRouter.patch(
  '/customers/:id',
  asyncHandler(async (req, res) => {
    const { params, body } = updateCustomerSchema.parse({ params: req.params, body: req.body });

    const existing = await prisma.customer.findUnique({ where: { id: params.id } });
    if (!existing) throw new HttpError(404, '客户不存在');

    const customer = await prisma.customer.update({
      where: { id: params.id },
      data: body,
      include: { _count: { select: { orders: true } } },
    });

    res.json({ data: customer });
  })
);

operationsRouter.delete(
  '/customers/:id',
  asyncHandler(async (req, res) => {
    const { params } = customerIdSchema.parse({ params: req.params });
    const orderCount = await prisma.order.count({ where: { customerId: params.id } });
    if (orderCount > 0) throw new HttpError(409, '客户存在关联订单，无法删除');

    await prisma.customer.delete({ where: { id: params.id } });
    res.status(204).send();
  })
);

// ─── Orders ───────────────────────────────────────────────────

operationsRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const { query } = listOrdersSchema.parse({ query: req.query });
    const where: Prisma.OrderWhereInput = {};

    if (query.customerId) where.customerId = query.customerId;
    if (query.agentId) where.agentId = query.agentId;
    if (query.status) where.status = query.status;
    if (query.serviceType) where.serviceType = { contains: query.serviceType, mode: 'insensitive' };
    if (query.search) {
      where.OR = [
        { serviceType: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { customer: { email: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      data: items,
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    });
  })
);

operationsRouter.post(
  '/orders',
  asyncHandler(async (req, res) => {
    const { body } = createOrderSchema.parse({ body: req.body });
    const customer = await prisma.customer.findUnique({ where: { id: body.customerId } });
    if (!customer) throw new HttpError(404, '客户不存在');

    const order = await prisma.order.create({
      data: {
        customerId: body.customerId,
        agentId: body.agentId,
        serviceType: body.serviceType,
        amount: decimal(body.amount),
        status: body.status,
        description: body.description,
      },
      include: orderInclude,
    });

    res.status(201).json({ data: order });
  })
);

operationsRouter.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const { params } = orderIdSchema.parse({ params: req.params });
    const order = await prisma.order.findUnique({
      where: { id: params.id },
      include: orderInclude,
    });

    if (!order) throw new HttpError(404, '订单不存在');
    res.json({ data: order });
  })
);

operationsRouter.patch(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const { params, body } = updateOrderSchema.parse({ params: req.params, body: req.body });

    const existing = await prisma.order.findUnique({ where: { id: params.id } });
    if (!existing) throw new HttpError(404, '订单不存在');

    if (body.customerId && body.customerId !== existing.customerId) {
      const customer = await prisma.customer.findUnique({ where: { id: body.customerId } });
      if (!customer) throw new HttpError(404, '客户不存在');
    }

    const data: Prisma.OrderUncheckedUpdateInput = {};
    if (body.customerId !== undefined) data.customerId = body.customerId;
    if (body.agentId !== undefined) data.agentId = body.agentId;
    if (body.serviceType !== undefined) data.serviceType = body.serviceType;
    if (body.amount !== undefined) data.amount = decimal(body.amount);
    if (body.status !== undefined) data.status = body.status;
    if (body.description !== undefined) data.description = body.description;

    const order = await prisma.order.update({
      where: { id: params.id },
      data,
      include: orderInclude,
    });

    res.json({ data: order });
  })
);

operationsRouter.delete(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const { params } = orderIdSchema.parse({ params: req.params });
    const revenueCount = await prisma.revenueRecord.count({ where: { orderId: params.id } });
    if (revenueCount > 0) throw new HttpError(409, '订单存在营收记录，无法删除');

    await prisma.order.delete({ where: { id: params.id } });
    res.status(204).send();
  })
);

// ─── Revenue Records ──────────────────────────────────────────

operationsRouter.post(
  '/orders/:orderId/revenue-records',
  asyncHandler(async (req, res) => {
    const { params, body } = createRevenueRecordSchema.parse({ params: { orderId: req.params.orderId }, body: req.body });
    const orderId = params?.orderId ?? body.orderId;
    if (!orderId) throw new HttpError(400, '缺少订单 ID');

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new HttpError(404, '订单不存在');

    const record = await prisma.revenueRecord.create({
      data: {
        orderId,
        agentId: body.agentId ?? order.agentId,
        amount: decimal(body.amount),
        type: body.type,
        month: body.month,
      },
    });

    res.status(201).json({ data: record });
  })
);

operationsRouter.patch(
  '/revenue-records/:id',
  asyncHandler(async (req, res) => {
    const { params, body } = updateRevenueRecordSchema.parse({ params: req.params, body: req.body });
    const existing = await prisma.revenueRecord.findUnique({ where: { id: params.id } });
    if (!existing) throw new HttpError(404, '营收记录不存在');

    const data: Prisma.RevenueRecordUncheckedUpdateInput = {};
    if (body.agentId !== undefined) data.agentId = body.agentId;
    if (body.amount !== undefined) data.amount = decimal(body.amount);
    if (body.type !== undefined) data.type = body.type;
    if (body.month !== undefined) data.month = body.month;

    const record = await prisma.revenueRecord.update({ where: { id: params.id }, data });
    res.json({ data: record });
  })
);

operationsRouter.delete(
  '/revenue-records/:id',
  asyncHandler(async (req, res) => {
    const { params } = revenueRecordIdSchema.parse({ params: req.params });
    await prisma.revenueRecord.delete({ where: { id: params.id } });
    res.status(204).send();
  })
);

// ─── Revenue Summary ──────────────────────────────────────────

operationsRouter.get(
  '/revenue/summary',
  asyncHandler(async (req, res) => {
    const { query } = revenueSummarySchema.parse({ query: req.query });
    const where: Prisma.RevenueRecordWhereInput = {};
    const monthFilter = monthRange(query.monthFrom, query.monthTo);

    if (query.agentId) where.agentId = query.agentId;
    if (query.type) where.type = query.type;
    if (monthFilter) where.month = monthFilter;

    const records = await prisma.revenueRecord.findMany({
      where,
      include: { order: { include: { customer: true } } },
      orderBy: [{ month: 'asc' }, { createdAt: 'asc' }],
    });
    const agentMap = await getAgentMap(records.map((record) => record.agentId));

    const totals = { grossRevenue: 0, refundAmount: 0, netRevenue: 0, recurringRevenue: 0, oneTimeRevenue: 0, recordCount: records.length };
    const monthlyMap = new Map<string, { month: string; grossRevenue: number; refundAmount: number; netRevenue: number; recordCount: number }>();
    const agentMapRows = new Map<string, { agentId: string | null; grossRevenue: number; refundAmount: number; netRevenue: number; recordCount: number }>();

    for (const record of records) {
      const amount = decimalToNumber(record.amount);
      const month = record.month ?? record.createdAt.toISOString().slice(0, 7);
      const agentKey = record.agentId ?? 'unassigned';
      const signed = record.type === 'refund' ? -Math.abs(amount) : amount;

      totals.netRevenue += signed;
      if (record.type === 'refund') totals.refundAmount += Math.abs(amount);
      else totals.grossRevenue += amount;
      if (record.type === 'recurring') totals.recurringRevenue += amount;
      if (record.type === 'one_time') totals.oneTimeRevenue += amount;

      const monthly = monthlyMap.get(month) ?? { month, grossRevenue: 0, refundAmount: 0, netRevenue: 0, recordCount: 0 };
      monthly.recordCount += 1;
      monthly.netRevenue += signed;
      if (record.type === 'refund') monthly.refundAmount += Math.abs(amount);
      else monthly.grossRevenue += amount;
      monthlyMap.set(month, monthly);

      const agent = agentMapRows.get(agentKey) ?? { agentId: record.agentId, grossRevenue: 0, refundAmount: 0, netRevenue: 0, recordCount: 0 };
      agent.recordCount += 1;
      agent.netRevenue += signed;
      if (record.type === 'refund') agent.refundAmount += Math.abs(amount);
      else agent.grossRevenue += amount;
      agentMapRows.set(agentKey, agent);
    }

    const byAgent = Array.from(agentMapRows.values())
      .map((row) => ({ ...row, agent: agentPayload(row.agentId, agentMap) }))
      .sort((a, b) => b.netRevenue - a.netRevenue);

    res.json({
      data: {
        summary: totals,
        monthly: Array.from(monthlyMap.values()),
        byAgent,
        recentRecords: records.slice(-10).reverse(),
      },
    });
  })
);

// ─── Agent Performance ────────────────────────────────────────

operationsRouter.get(
  '/agent-performance',
  asyncHandler(async (req, res) => {
    const { query } = agentPerformanceSchema.parse({ query: req.query });
    const orderWhere: Prisma.OrderWhereInput = {};
    const revenueWhere: Prisma.RevenueRecordWhereInput = {};
    const dateFilter = createdAtRange(query.monthFrom, query.monthTo);
    const monthFilter = monthRange(query.monthFrom, query.monthTo);

    if (query.agentId) {
      orderWhere.agentId = query.agentId;
      revenueWhere.agentId = query.agentId;
    }
    if (dateFilter) orderWhere.createdAt = dateFilter;
    if (monthFilter) revenueWhere.month = monthFilter;

    const [orders, revenues] = await Promise.all([
      prisma.order.findMany({ where: orderWhere, include: { customer: true } }),
      prisma.revenueRecord.findMany({ where: revenueWhere }),
    ]);

    const agentMap = await getAgentMap([
      ...orders.map((order) => order.agentId),
      ...revenues.map((record) => record.agentId),
    ]);

    const rows = new Map<string, {
      agentId: string | null;
      totalOrders: number;
      completedOrders: number;
      cancelledOrders: number;
      totalOrderAmount: number;
      grossRevenue: number;
      refundAmount: number;
      netRevenue: number;
      revenueRecords: number;
    }>();

    const ensureRow = (agentId: string | null) => {
      const key = agentId ?? 'unassigned';
      const row = rows.get(key) ?? {
        agentId,
        totalOrders: 0,
        completedOrders: 0,
        cancelledOrders: 0,
        totalOrderAmount: 0,
        grossRevenue: 0,
        refundAmount: 0,
        netRevenue: 0,
        revenueRecords: 0,
      };
      rows.set(key, row);
      return row;
    };

    for (const order of orders) {
      const row = ensureRow(order.agentId);
      row.totalOrders += 1;
      row.totalOrderAmount += decimalToNumber(order.amount);
      if (order.status === 'completed') row.completedOrders += 1;
      if (order.status === 'cancelled') row.cancelledOrders += 1;
    }

    for (const record of revenues) {
      const row = ensureRow(record.agentId);
      const amount = decimalToNumber(record.amount);
      row.revenueRecords += 1;
      if (record.type === 'refund') {
        row.refundAmount += Math.abs(amount);
        row.netRevenue -= Math.abs(amount);
      } else {
        row.grossRevenue += amount;
        row.netRevenue += amount;
      }
    }

    const performance = Array.from(rows.values())
      .map((row) => ({
        ...row,
        agent: agentPayload(row.agentId, agentMap),
        averageOrderValue: row.totalOrders > 0 ? row.totalOrderAmount / row.totalOrders : 0,
        completionRate: row.totalOrders > 0 ? row.completedOrders / row.totalOrders : 0,
      }))
      .sort((a, b) => b.netRevenue - a.netRevenue)
      .map((row, index) => ({ ...row, rank: index + 1 }));

    res.json({
      data: {
        summary: {
          totalAgents: performance.length,
          totalOrders: orders.length,
          completedOrders: orders.filter((order) => order.status === 'completed').length,
          netRevenue: performance.reduce((sum, row) => sum + row.netRevenue, 0),
        },
        performance,
      },
    });
  })
);
