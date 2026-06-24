import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

async function loadMiddleware(nodeEnv: 'development' | 'test' | 'production', allowedIps?: string) {
  vi.resetModules();
  vi.doMock('../config/env.js', () => ({
    env: {
      NODE_ENV: nodeEnv,
      GATEWAY_ALLOWED_IPS: allowedIps,
    },
  }));

  return import('../middleware/ip-whitelist.js');
}

function createReq(
  remoteAddress: string,
  options: {
    path?: string;
    headers?: Record<string, string>;
    hostname?: string;
    localAddress?: string;
  } = {}
): Request {
  return {
    path: options.path ?? '/api/auth/agent/login',
    headers: options.headers ?? {},
    hostname: options.hostname ?? 'test-server.local',
    socket: {
      remoteAddress,
      localAddress: options.localAddress ?? '{your-server-ip}',
    },
    requestId: 'test-request-id',
  } as unknown as Request;
}

function createRes(): Response & {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe('gatewayGuard', () => {
  it('skips checks outside production', async () => {
    const { gatewayGuard } = await loadMiddleware('development');
    const middleware = gatewayGuard();
    const res = createRes();
    const next = vi.fn() as NextFunction;

    middleware(createReq('203.0.113.10'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows localhost in production', async () => {
    const { gatewayGuard } = await loadMiddleware('production');
    const middleware = gatewayGuard();
    const res = createRes();
    const next = vi.fn() as NextFunction;

    middleware(createReq('127.0.0.1'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows RFC 1918 private addresses in production', async () => {
    const { gatewayGuard } = await loadMiddleware('production');
    const middleware = gatewayGuard();
    const res = createRes();
    const next = vi.fn() as NextFunction;

    for (const ip of ['10.0.0.5', '172.16.5.10', '192.168.1.15']) {
      middleware(createReq(ip), res, next);
      expect(next).toHaveBeenCalled();
      vi.clearAllMocks();
    }
  });

  it('blocks external IPs in production', async () => {
    const { gatewayGuard } = await loadMiddleware('production');
    const middleware = gatewayGuard();
    const res = createRes();
    const next = vi.fn() as NextFunction;

    middleware(createReq('203.0.113.10'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Forbidden',
        message: 'Direct access is not allowed',
      })
    );
  });

  it('allows extra IPs from GATEWAY_ALLOWED_IPS', async () => {
    const { gatewayGuard } = await loadMiddleware('production', '203.0.113.10,198.51.100.20');
    const middleware = gatewayGuard('203.0.113.10,198.51.100.20');
    const res = createRes();
    const next = vi.fn() as NextFunction;

    middleware(createReq('203.0.113.10'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('always allows /api/health endpoint', async () => {
    const { gatewayGuard } = await loadMiddleware('production');
    const middleware = gatewayGuard();
    const res = createRes();
    const next = vi.fn() as NextFunction;

    const req = createReq('203.0.113.10', { path: '/api/health' });
    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('internalOnly', () => {
  it('allows localhost', async () => {
    const { internalOnly } = await loadMiddleware('development');
    const res = createRes();
    const next = vi.fn() as NextFunction;

    internalOnly(createReq('127.0.0.1'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows IPv6 localhost', async () => {
    const { internalOnly } = await loadMiddleware('development');
    const res = createRes();
    const next = vi.fn() as NextFunction;

    internalOnly(createReq('::1'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks RFC 1918 addresses', async () => {
    const { internalOnly } = await loadMiddleware('development');
    const res = createRes();
    const next = vi.fn() as NextFunction;

    for (const ip of ['10.0.0.5', '172.16.5.10', '192.168.1.15']) {
      internalOnly(createReq(ip), res, next);
    }

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Forbidden',
        message: 'Internal access only',
      })
    );
  });

  it('blocks external IPs', async () => {
    const { internalOnly } = await loadMiddleware('development');
    const res = createRes();
    const next = vi.fn() as NextFunction;

    internalOnly(createReq('203.0.113.10'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Forbidden',
        message: 'Internal access only',
      })
    );
  });
});

describe('ipWhitelist', () => {
  it('allows RFC 1918 addresses', async () => {
    const { ipWhitelist } = await loadMiddleware('development');
    const res = createRes();
    const next = vi.fn() as NextFunction;

    for (const ip of ['10.0.0.5', '172.16.5.10', '192.168.1.15']) {
      ipWhitelist(createReq(ip), res, next);
      expect(next).toHaveBeenCalled();
      vi.clearAllMocks();
    }
  });

  it('blocks external IPs', async () => {
    const { ipWhitelist } = await loadMiddleware('development');
    const res = createRes();
    const next = vi.fn() as NextFunction;

    ipWhitelist(createReq('203.0.113.10'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Forbidden',
        message: '注册仅限内网访问',
      })
    );
  });
});
