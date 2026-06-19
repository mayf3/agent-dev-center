import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  createServiceSchema,
  updateServiceSchema,
  serviceIdSchema,
  listServicesSchema,
} from '../schemas/service.js';

export const servicesRouter = Router();

// ─── Health-check (legacy, keeps existing /status & /refresh) ──────────

interface ServiceEntry {
  group: 'local' | 'remote';
  name: string;
  port: number;
  url: string;
  type: string;
}

const HEALTH_SERVICES: ServiceEntry[] = [
  { group: 'local', name: '🛒 购物清单', port: 3001, url: 'http://127.0.0.1:3001', type: 'React + Node' },
  { group: 'local', name: '📈 KPI 面板', port: 3457, url: 'http://127.0.0.1:3457/api/health', type: 'Express + TSX' },
  { group: 'local', name: '📋 LLM Todo (本地)', port: 3458, url: 'http://127.0.0.1:3458/api/health', type: 'Express + TSX' },
  { group: 'local', name: '🔬 深度研究', port: 3480, url: 'http://127.0.0.1:3480/api/health', type: 'Express + SQLite' },
  { group: 'local', name: '✍️ 文章审稿', port: 5173, url: 'http://127.0.0.1:5173', type: 'Vite + React' },
  { group: 'local', name: '🎙️ 播客转录查看器', port: 53821, url: 'http://127.0.0.1:53821', type: 'Node HTTP' },
  { group: 'local', name: '🌐 前沿观察', port: 8088, url: 'http://127.0.0.1:8088', type: 'Python HTTP' },
  { group: 'local', name: '🔍 Biz Explorer (网站)', port: 34567, url: 'http://127.0.0.1:34567', type: '11ty' },
  { group: 'local', name: '🔍 Biz Explorer (API)', port: 34568, url: 'http://127.0.0.1:34568', type: 'Express' },
  { group: 'remote', name: '🏠 Agent Dev Center (前端)', port: 80, url: 'http://8.163.44.127/', type: 'React (Docker)' },
  { group: 'remote', name: '🏠 Agent Dev Center (API)', port: 4000, url: 'http://8.163.44.127/api/health', type: 'Node (Docker)' },
  { group: 'remote', name: '📋 LLM Todo (远程)', port: 8720, url: 'http://8.163.44.127/todo/api/health', type: 'Python (systemd)' },
  { group: 'remote', name: '🔀 Nginx 反向代理', port: 80, url: 'http://8.163.44.127/health', type: 'Nginx' },
  { group: 'remote', name: '📊 Netdata 监控', port: 19999, url: 'http://8.163.44.127:19999', type: 'Netdata' },
  { group: 'remote', name: '📱 统一登录门户', port: 80, url: 'http://8.163.44.127/portal/', type: 'React (Nginx)' },
];

interface HealthResult {
  name: string;
  group: string;
  port: number;
  url: string;
  type: string;
  link: string;
  status: 'online' | 'offline';
  statusCode: number | null;
  responseTime: number | null;
  checkedAt: string;
}

let cachedResults: HealthResult[] = [];
let lastCheckTime = 0;
const CACHE_TTL = 55_000;

async function checkService(svc: ServiceEntry): Promise<HealthResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(svc.url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'AgentDevCenter/1.0 health-check' },
    });
    clearTimeout(timeout);
    const responseTime = Date.now() - start;
    const online = res.status < 500;
    return {
      name: svc.name, group: svc.group, port: svc.port, url: svc.url, type: svc.type,
      link: svc.url.replace(/\/api\/health\/?$/, '').replace(/\/health\/?$/, ''),
      status: online ? 'online' : 'offline',
      statusCode: res.status, responseTime, checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      name: svc.name, group: svc.group, port: svc.port, url: svc.url, type: svc.type,
      link: svc.url.replace(/\/api\/health\/?$/, '').replace(/\/health\/?$/, ''),
      status: 'offline', statusCode: null, responseTime: null, checkedAt: new Date().toISOString(),
    };
  }
}

async function runHealthCheck(): Promise<HealthResult[]> {
  const results = await Promise.all(HEALTH_SERVICES.map(checkService));
  cachedResults = results;
  lastCheckTime = Date.now();
  return results;
}

// GET /api/services/status — legacy health-check
servicesRouter.get('/status', authRequired, async (_req, res) => {
  try {
    let results = cachedResults;
    if (Date.now() - lastCheckTime > CACHE_TTL || results.length === 0) {
      results = await runHealthCheck();
    }
    const local = results.filter(r => r.group === 'local');
    const remote = results.filter(r => r.group === 'remote');
    const online = results.filter(r => r.status === 'online').length;
    const offline = results.filter(r => r.status === 'offline').length;
    res.json({
      data: { local, remote },
      summary: { total: results.length, online, offline },
      checkedAt: new Date().toISOString(),
    });
  } catch {
    res.status(500).json({ message: '健康检查失败' });
  }
});

// POST /api/services/refresh — force refresh health-check
servicesRouter.post('/refresh', authRequired, async (_req, res) => {
  try {
    const results = await runHealthCheck();
    const online = results.filter(r => r.status === 'online').length;
    const offline = results.filter(r => r.status === 'offline').length;
    res.json({
      data: { local: results.filter(r => r.group === 'local'), remote: results.filter(r => r.group === 'remote') },
      summary: { total: results.length, online, offline },
      checkedAt: new Date().toISOString(),
    });
  } catch {
    res.status(500).json({ message: '刷新失败' });
  }
});

// ─── Service Registry CRUD ─────────────────────────────────────────────

// GET /api/services — list registered services
servicesRouter.get(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const { query } = listServicesSchema.parse({ query: req.query });
    const where: Prisma.ServiceWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.owner) {
      where.owner = { contains: query.owner, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      prisma.service.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.service.count({ where }),
    ]);

    res.json({
      data: items,
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    });
  })
);

// GET /api/services/:id — service detail
servicesRouter.get(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    serviceIdSchema.parse({ params: { id } });

    const service = await prisma.service.findUnique({
      where: { id },
      include: {
        requirements: {
          include: { requirement: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!service) throw new HttpError(404, '服务不存在');
    res.json({ data: service });
  })
);

// POST /api/services — register a new service
servicesRouter.post(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const { body } = createServiceSchema.parse({ body: req.body });

    // check unique name
    const existing = await prisma.service.findUnique({ where: { name: body.name } });
    if (existing) throw new HttpError(409, `服务名 "${body.name}" 已被注册`);

    const service = await prisma.service.create({ data: body });
    res.status(201).json({ data: service });
  })
);

// PATCH /api/services/:id — update service
servicesRouter.patch(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const { body } = updateServiceSchema.parse({ params: { id }, body: req.body });

    const existing = await prisma.service.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, '服务不存在');

    // if name is being updated, check uniqueness
    if (body.name && body.name !== existing.name) {
      const dup = await prisma.service.findUnique({ where: { name: body.name } });
      if (dup) throw new HttpError(409, `服务名 "${body.name}" 已被注册`);
    }

    const service = await prisma.service.update({
      where: { id },
      data: body,
    });
    res.json({ data: service });
  })
);

// GET /api/services/:id/commits — git commit history
servicesRouter.get(
  '/:id/commits',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    serviceIdSchema.parse({ params: { id } });

    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) throw new HttpError(404, '服务不存在');
    if (!service.gitRepo) {
      res.json({ data: [], total: 0, message: '未配置 Git 仓库路径' });
      return;
    }

    const limit = Math.min(parseInt(String(req.query.limit)) || 20, 100);

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    try {
      const { stdout } = await execFileAsync('git', [
        '-C', service.gitRepo,
        'log',
        `--max-count=${limit}`,
        '--pretty=format:%H|%h|%an|%ae|%at|%s',
        '--no-merges',
      ], { timeout: 10_000 });

      if (!stdout.trim()) {
        res.json({ data: [], total: 0 });
        return;
      }

      const commits = stdout.trim().split('\n').map((line) => {
        const [hash, shortHash, author, email, timestamp, message] = line.split('|');
        return {
          hash,
          shortHash,
          author,
          email,
          date: new Date(parseInt(timestamp) * 1000).toISOString(),
          message,
        };
      });

      res.json({ data: commits, total: commits.length });
    } catch (err) {
      throw new HttpError(500, `获取 Git 记录失败: ${(err as Error).message}`);
    }
  })
);

// GET /api/services/:id/requirements — related requirements (grouped by status)
servicesRouter.get(
  '/:id/requirements',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    serviceIdSchema.parse({ params: { id } });

    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) throw new HttpError(404, '服务不存在');

    const relations = await prisma.serviceRequirement.findMany({
      where: { serviceId: id },
      include: { requirement: true },
      orderBy: { createdAt: 'desc' },
    });

    // group by currentStep
    const grouped: Record<string, typeof relations> = {};
    for (const rel of relations) {
      const step = rel.requirement.currentStep || 'unknown';
      if (!grouped[step]) grouped[step] = [];
      grouped[step].push(rel);
    }

    res.json({ data: relations, grouped, total: relations.length });
  })
);
export const router = servicesRouter;
export const mountPath = '/api/services';
