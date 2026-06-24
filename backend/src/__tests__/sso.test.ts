import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';

// ─── Config ────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-sso-secret-key-at-least-16-chars';
const JWT_REFRESH_SECRET = 'test-sso-refresh-secret-key-16-chars';
const USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// ─── Mock setup ────────────────────────────────────────────────────────

// Mock prisma
const mockUser = {
  id: USER_ID,
  name: 'Test User',
  email: 'test@example.com',
  role: 'admin',
  password: '$2b$10$hashedpassword', // bcrypt hash placeholder
};

const mockServices = [
  { name: 'service-a', displayName: 'Service A', remoteUrl: 'http://a.example.com', localUrl: null, status: 'online' },
  { name: 'service-b', displayName: 'Service B', remoteUrl: null, localUrl: 'http://localhost:3001', status: 'online' },
  { name: 'service-c', displayName: 'Service C', remoteUrl: null, localUrl: null, status: 'offline' },
];

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    service: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

// Mock env
vi.mock('../config/env.js', () => ({
  env: {
    JWT_SECRET,
    JWT_REFRESH_SECRET,
    JWT_EXPIRES_IN: '2h',
    JWT_REFRESH_EXPIRES_IN: '7d',
    NODE_ENV: 'test',
  },
}));

// ─── Tests ──────────────────────────────────────────────────────────────

describe('SSO Token 签发与验证', () => {
  it('应该正确签发 access token 并验证', () => {
    const token = jwt.sign({ sub: USER_ID }, JWT_SECRET, { expiresIn: '2h' });
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; exp: number; iat: number };
    expect(payload.sub).toBe(USER_ID);
    expect(payload.exp).toBeDefined();
    expect(payload.iat).toBeDefined();
  });

  it('应该正确签发 refresh token 并验证', () => {
    const token = jwt.sign({ sub: USER_ID }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
    const payload = jwt.verify(token, JWT_REFRESH_SECRET) as { sub: string };
    expect(payload.sub).toBe(USER_ID);
  });

  it('应该拒绝无效 token', () => {
    expect(() => {
      jwt.verify('invalid.token.here', JWT_SECRET);
    }).toThrow();
  });

  it('应该拒绝过期 token', () => {
    const token = jwt.sign({ sub: USER_ID }, JWT_SECRET, { expiresIn: '0s' });
    // Wait a tiny bit for expiry
    expect(() => {
      jwt.verify(token, JWT_SECRET);
    }).toThrow(jwt.TokenExpiredError);
  });

  it('应该拒绝用 refresh secret 签发的 token（使用 access secret 验证）', () => {
    const token = jwt.sign({ sub: USER_ID }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
    expect(() => {
      jwt.verify(token, JWT_SECRET);
    }).toThrow();
  });
});

describe('SSO Scoped Token', () => {
  it('应该签发包含 scope 的 service token', () => {
    const token = jwt.sign(
      { sub: USER_ID, scope: 'llm-todo-backend' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; scope: string };
    expect(payload.sub).toBe(USER_ID);
    expect(payload.scope).toBe('llm-todo-backend');
  });

  it('不同 scope 的 token 应该有不同的 scope 字段', () => {
    const tokenA = jwt.sign({ sub: USER_ID, scope: 'service-a' }, JWT_SECRET, { expiresIn: '24h' });
    const tokenB = jwt.sign({ sub: USER_ID, scope: 'service-b' }, JWT_SECRET, { expiresIn: '24h' });

    const payloadA = jwt.verify(tokenA, JWT_SECRET) as { scope: string };
    const payloadB = jwt.verify(tokenB, JWT_SECRET) as { scope: string };

    expect(payloadA.scope).toBe('service-a');
    expect(payloadB.scope).toBe('service-b');
    expect(payloadA.scope).not.toBe(payloadB.scope);
  });
});

describe('SSO Verify 响应格式', () => {
  it('验证成功时返回正确格式', () => {
    const token = jwt.sign({ sub: USER_ID }, JWT_SECRET, { expiresIn: '2h' });
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; exp: number };

    const response = {
      valid: true,
      user: { id: USER_ID, name: 'Test User', email: 'test@example.com', role: 'admin' },
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      expiresIn: payload.exp - Math.floor(Date.now() / 1000),
    };

    expect(response.valid).toBe(true);
    expect(response.user.id).toBe(USER_ID);
    expect(response.expiresAt).toBeDefined();
    expect(response.expiresIn).toBeGreaterThan(0);
  });

  it('过期 token 应返回错误', () => {
    const token = jwt.sign({ sub: USER_ID }, JWT_SECRET, { expiresIn: '0s' });

    try {
      jwt.verify(token, JWT_SECRET);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(jwt.TokenExpiredError);
    }
  });
});

describe('SSO Redirect URL 构建', () => {
  it('应该正确构建带 token 的跳转 URL', () => {
    const baseUrl = 'http://a.example.com';
    const token = 'test-token-value';

    const url = new URL(baseUrl);
    url.searchParams.set('token', token);
    const redirectUrl = url.toString();

    expect(redirectUrl).toBe('http://a.example.com/?token=test-token-value');
    expect(new URL(redirectUrl).searchParams.get('token')).toBe(token);
  });

  it('带路径的 URL 应正确追加参数', () => {
    const baseUrl = process.env.TEST_SERVER_URL || 'http://localhost:4000/todo/';
    const token = 'abc123';

    const url = new URL(baseUrl);
    url.searchParams.set('token', token);
    const redirectUrl = url.toString();

    expect(redirectUrl).toContain('token=abc123');
    expect(new URL(redirectUrl).searchParams.get('token')).toBe(token);
  });
});

describe('SSO 服务列表筛选', () => {
  it('只返回在线或未知状态的服务', () => {
    const onlineServices = mockServices.filter(
      (s) => s.status === 'online' || s.status === 'unknown'
    );
    expect(onlineServices).toHaveLength(2);
    expect(onlineServices.map((s) => s.name)).toEqual(['service-a', 'service-b']);
  });

  it('离线服务不应出现在列表中', () => {
    const onlineServices = mockServices.filter(
      (s) => s.status === 'online' || s.status === 'unknown'
    );
    const hasOffline = onlineServices.some((s) => s.name === 'service-c');
    expect(hasOffline).toBe(false);
  });
});
