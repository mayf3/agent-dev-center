import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';

export const servicesRouter = Router();

interface ServiceEntry {
  group: 'local' | 'remote';
  name: string;
  port: number;
  url: string;
  type: string;
}

// All known services
const SERVICES: ServiceEntry[] = [
  // Local services (Mac)
  { group: 'local', name: '🛒 购物清单', port: 3001, url: 'http://127.0.0.1:3001', type: 'React + Node' },
  { group: 'local', name: '📈 KPI 面板', port: 3457, url: 'http://127.0.0.1:3457/api/health', type: 'Express + TSX' },
  { group: 'local', name: '📋 LLM Todo (本地)', port: 3458, url: 'http://127.0.0.1:3458/api/health', type: 'Express + TSX' },
  { group: 'local', name: '🔬 深度研究', port: 3480, url: 'http://127.0.0.1:3480/api/health', type: 'Express + SQLite' },
  { group: 'local', name: '✍️ 文章审稿', port: 5173, url: 'http://127.0.0.1:5173', type: 'Vite + React' },
  { group: 'local', name: '🎙️ 播客转录查看器', port: 53821, url: 'http://127.0.0.1:53821', type: 'Node HTTP' },
  { group: 'local', name: '🌐 前沿观察', port: 8088, url: 'http://127.0.0.1:8088', type: 'Python HTTP' },
  { group: 'local', name: '🔍 Biz Explorer (网站)', port: 34567, url: 'http://127.0.0.1:34567', type: '11ty' },
  { group: 'local', name: '🔍 Biz Explorer (API)', port: 34568, url: 'http://127.0.0.1:34568', type: 'Express' },

  // Remote services (Alibaba Cloud)
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

// Cached results
let cachedResults: HealthResult[] = [];
let lastCheckTime = 0;
const CACHE_TTL = 55_000; // ~55 seconds (frontend refreshes every 60s)

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

    // 401 still counts as online (service is responding, just needs auth)
    const online = res.status < 500;

    return {
      name: svc.name,
      group: svc.group,
      port: svc.port,
      url: svc.url,
      type: svc.type,
      // Generate clickable link (strip /api/health paths)
      link: svc.url.replace(/\/api\/health\/?$/, '').replace(/\/health\/?$/, ''),
      status: online ? 'online' : 'offline',
      statusCode: res.status,
      responseTime,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      name: svc.name,
      group: svc.group,
      port: svc.port,
      url: svc.url,
      type: svc.type,
      link: svc.url.replace(/\/api\/health\/?$/, '').replace(/\/health\/?$/, ''),
      status: 'offline',
      statusCode: null,
      responseTime: null,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function runHealthCheck(): Promise<HealthResult[]> {
  const results = await Promise.all(SERVICES.map(checkService));
  cachedResults = results;
  lastCheckTime = Date.now();
  return results;
}

// GET /api/services/status
servicesRouter.get('/status', authRequired, async (_req, res) => {
  try {
    let results = cachedResults;

    // If cache expired, run fresh check
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
  } catch (error) {
    res.status(500).json({ message: '健康检查失败' });
  }
});

// POST /api/services/refresh — force refresh
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
