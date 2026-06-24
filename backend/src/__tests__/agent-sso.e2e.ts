import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

// ─── 测试常量 ────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-e2e-at-least-16-chars';
const JWT_SECRET_SSO = process.env.JWT_SECRET_SSO || 'test-sso-secret-for-e2e-at-least-16-chars';
const TEST_AGENT_ID = 'test-e2e-agent';
const TEST_AGENT_NAME = 'E2E测试Agent';

// ─── 辅助函数 ────────────────────────────────────────────────
function signTestToken(payload: object): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

async function cleanup() {
  // 清理测试数据
  const agent = await prisma.marketplaceAgent.findUnique({ where: { name: TEST_AGENT_ID } });
  if (agent) {
    await prisma.agentAccessToken.deleteMany({ where: { agentId: agent.id } });
    await prisma.marketplaceAgent.delete({ where: { id: agent.id } });
  }
  const user = await prisma.user.findFirst({ where: { agentId: TEST_AGENT_ID } });
  if (user) {
    await prisma.marketplaceAgent.deleteMany({ where: { ownerId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

// ─── 测试 ────────────────────────────────────────────────────
describe('Unified Agent SSO — E2E Tests', () => {
  let adminToken: string;
  let agentToken: string;
  let agentJwt: string;
  let agentUserId: string;
  let marketplaceAgentId: string;

  beforeAll(async () => {
    await cleanup();
    // Admin token（模拟管理员登录）
    const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
    if (admin) {
      adminToken = signTestToken({ sub: admin.id });
    } else {
      // 创建测试 admin
      const newAdmin = await prisma.user.create({
        data: {
          name: 'Test Admin',
          email: 'test-admin@sso.e2e',
          password: await bcrypt.hash('test', 10),
          role: 'admin',
        },
      });
      adminToken = signTestToken({ sub: newAdmin.id });
    }
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  // ─── 1. Agent 注册 ──────────────────────────────────────────

  describe('Agent Registration', () => {
    it('should register a new agent', async () => {
      const res = await fetch('http://localhost:3000/api/auth/agent/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: TEST_AGENT_ID,
          name: TEST_AGENT_NAME,
          category: 'testing',
          role: 'dev-agent',
          capabilities: ['e2e-testing'],
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.user.agentId).toBe(TEST_AGENT_ID);
      expect(data.agentToken).toMatch(/^agent_/);
      expect(data.jwt).toBeTruthy();

      agentToken = data.agentToken;
      agentJwt = data.jwt;
      agentUserId = data.user.id;
    });

    it('should reject duplicate registration', async () => {
      const res = await fetch('http://localhost:3000/api/auth/agent/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: TEST_AGENT_ID,
          name: TEST_AGENT_NAME,
          role: 'dev-agent',
        }),
      });

      expect(res.status).toBe(409);
    });

    it('should have created User with role=agent', async () => {
      const user = await prisma.user.findFirst({ where: { agentId: TEST_AGENT_ID } });
      expect(user).toBeTruthy();
      expect(user!.role).toBe('agent');
      expect(user!.agentId).toBe(TEST_AGENT_ID);
    });

    it('should have created MarketplaceAgent', async () => {
      const agent = await prisma.marketplaceAgent.findUnique({ where: { name: TEST_AGENT_ID } });
      expect(agent).toBeTruthy();
      expect(agent!.displayName).toBe(TEST_AGENT_NAME);
      marketplaceAgentId = agent!.id;
    });

    it('should have created AgentAccessToken', async () => {
      const token = await prisma.agentAccessToken.findFirst({
        where: { agentId: marketplaceAgentId, name: 'sso-default' },
      });
      expect(token).toBeTruthy();
      expect(token!.token).toMatch(/^agent_/);
    });

    it('should have dev-agent default permissions', async () => {
      const user = await prisma.user.findFirst({ where: { agentId: TEST_AGENT_ID } });
      const perms = (user!.permissions as string[]) ?? [];
      expect(perms).toContain('todo:read');
      expect(perms).toContain('todo:write');
      expect(perms).toContain('marketplace:claim');
      expect(perms).not.toContain('admin');
    });
  });

  // ─── 2. Agent 登录 ──────────────────────────────────────────

  describe('Agent Login', () => {
    it('should login with agent token', async () => {
      const res = await fetch('http://localhost:3000/api/auth/agent/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: TEST_AGENT_ID,
          token: agentToken,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.accessToken).toBeTruthy();
      expect(data.user.agentId).toBe(TEST_AGENT_ID);
      expect(data.user.role).toBe('agent');
      expect(data.services).toBeInstanceOf(Array);
    });

    it('should reject invalid token', async () => {
      const res = await fetch('http://localhost:3000/api/auth/agent/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: TEST_AGENT_ID,
          token: 'agent_invalid_token',
        }),
      });

      expect(res.status).toBe(401);
    });

    it('should reject non-existent agent', async () => {
      const res = await fetch('http://localhost:3000/api/auth/agent/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'non-existent-agent',
          token: agentToken,
        }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ─── 3. Token 验证 ──────────────────────────────────────────

  describe('Token Verification', () => {
    it('should verify a valid JWT', async () => {
      const res = await fetch('http://localhost:3000/api/auth/agent/verify', {
        headers: { Authorization: `Bearer ${agentJwt}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.valid).toBe(true);
      expect(data.agent.agentId).toBe(TEST_AGENT_ID);
      expect(data.agent.permissions).toBeInstanceOf(Array);
    });

    it('should reject an invalid JWT', async () => {
      const res = await fetch('http://localhost:3000/api/auth/agent/verify', {
        headers: { Authorization: 'Bearer invalid.jwt.token' },
      });

      expect(res.status).toBe(401);
    });
  });

  // ─── 4. 权限管理 ────────────────────────────────────────────

  describe('Permission Management', () => {
    it('should list agents (admin only)', async () => {
      const res = await fetch('http://localhost:3000/api/auth/agent/agents', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toBeInstanceOf(Array);
      const testAgent = data.data.find((a: any) => a.agentId === TEST_AGENT_ID);
      expect(testAgent).toBeTruthy();
    });

    it('should update agent role to manager-agent', async () => {
      const res = await fetch(`http://localhost:3000/api/auth/agent/agents/${TEST_AGENT_ID}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ role: 'manager-agent' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      const perms = data.data.permissions;
      expect(perms).toContain('requirement:write');
      expect(perms).toContain('marketplace:write');
    });

    it('should reflect updated permissions in DB', async () => {
      const user = await prisma.user.findFirst({ where: { agentId: TEST_AGENT_ID } });
      const perms = (user!.permissions as string[]) ?? [];
      expect(perms).toContain('requirement:write');
    });
  });

  // ─── 5. 批量迁移 ────────────────────────────────────────────

  describe('Batch Migration', () => {
    const migrationAgents = [
      { id: 'migrate-test-1', name: '迁移测试1', category: 'test', token: 'legacy-token-001', capabilities: ['test'] },
      { id: 'migrate-test-2', name: '迁移测试2', category: 'test', token: 'legacy-token-002', capabilities: ['test'] },
    ];

    afterAll(async () => {
      // 清理迁移测试数据
      for (const a of migrationAgents) {
        const u = await prisma.user.findFirst({ where: { agentId: a.id } });
        if (u) {
          const ma = await prisma.marketplaceAgent.findUnique({ where: { name: a.id } });
          if (ma) {
            await prisma.agentAccessToken.deleteMany({ where: { agentId: ma.id } });
            await prisma.marketplaceAgent.delete({ where: { id: ma.id } });
          }
          await prisma.user.delete({ where: { id: u.id } });
        }
      }
    });

    it('should migrate agents in batch', async () => {
      const res = await fetch('http://localhost:3000/api/auth/agent/migrate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ agents: migrationAgents }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.created).toBe(2);
      expect(data.errors).toBe(0);
    });

    it('should skip already-migrated agents', async () => {
      const res = await fetch('http://localhost:3000/api/auth/agent/migrate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ agents: migrationAgents }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.skipped).toBe(2);
    });
  });

  // ─── 6. JWT 结构验证 ────────────────────────────────────────

  describe('JWT Token Structure', () => {
    it('should contain correct payload fields', () => {
      const decoded = jwt.verify(agentJwt, JWT_SECRET_SSO) as any;
      expect(decoded.sub).toBe(TEST_AGENT_ID);
      expect(decoded.name).toBe(TEST_AGENT_NAME);
      expect(decoded.role).toBe('agent');
      expect(decoded.permissions).toBeInstanceOf(Array);
      expect(decoded.iat).toBeTruthy();
      expect(decoded.exp).toBeTruthy();
    });

    it('should have 7-day expiry', () => {
      const decoded = jwt.verify(agentJwt, JWT_SECRET_SSO) as any;
      const expiresInDays = (decoded.exp - decoded.iat) / 86400;
      expect(expiresInDays).toBe(7);
    });
  });
});
