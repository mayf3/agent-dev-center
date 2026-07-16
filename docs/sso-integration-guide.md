# SSO 统一认证集成指南

> 所有服务统一接入 Agent SSO（需求 6a59b517）
> 更新: 2026-05-15

---

## 架构

```
ADC (SSO Provider)
├── JWT_SECRET_SSO ───── 共享密钥 ──────┐
├── /api/auth/agent/login    签发 JWT   │
├── /api/auth/agent/verify   验证 JWT   │
└── /api/auth/agent/sync     推送 Agent  │
                                         ▼
各种服务 (SP — Service Provider)
  使用 SSO_JWT_SECRET = JWT_SECRET_SSO 验证
```

## 快速集成（10 分钟）

### 1. 复制标准中间件

将以下文件放入你的服务中：

**`src/middleware/sso-auth.ts`**:

```typescript
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export interface SsoUser {
  id: string;              // sub (agentId 或 UUID)
  agentId?: string;         // sub 别名
  name?: string;
  role?: string;
  permissions?: string[];
}

const SSO_JWT_SECRET = process.env.SSO_JWT_SECRET || '';

declare global {
  namespace Express {
    interface Request {
      ssoUser?: SsoUser;
    }
  }
}

/**
 * 非阻塞 SSO 认证
 * 有 token 则注入 req.ssoUser，无 token 或无效时不报错
 */
export function ssoAuth(req: Request, _res: Response, next: NextFunction) {
  if (!SSO_JWT_SECRET) return next();

  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return next();

  try {
    const payload = jwt.verify(token, SSO_JWT_SECRET) as {
      sub: string;
      name?: string;
      role?: string;
      permissions?: string[];
    };
    req.ssoUser = {
      id: payload.sub,
      agentId: payload.sub,
      name: payload.name,
      role: payload.role,
      permissions: payload.permissions,
    };
  } catch { /* ignore */ }

  next();
}

/**
 * 阻塞 SSO 认证 — 无有效 token 返回 401
 */
export function ssoRequired(req: Request, res: Response, next: NextFunction) {
  if (!SSO_JWT_SECRET) return next();

  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: '请先通过 SSO 登录' });

  try {
    const payload = jwt.verify(token, SSO_JWT_SECRET) as {
      sub: string;
      name?: string;
      role?: string;
      permissions?: string[];
    };
    req.ssoUser = {
      id: payload.sub,
      agentId: payload.sub,
      name: payload.name,
      role: payload.role,
      permissions: payload.permissions,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'SSO Token 无效或已过期' });
  }
}

/**
 * 权限守卫 — 检查指定权限
 */
export function ssoRequirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.ssoUser) return res.status(401).json({ error: '请先通过 SSO 登录' });

    const perms = req.ssoUser.permissions ?? [];
    if (perms.includes('admin') || perms.includes(permission)) return next();

    return res.status(403).json({ error: `权限不足: 需要 ${permission}` });
  };
}
```

### 2. 在 Express app 中注册

```typescript
import { ssoAuth } from './middleware/sso-auth.js';

const app = express();

// SSO 中间件（全局非阻塞）
app.use(ssoAuth);

// 健康检查端点可展示 SSO 状态
app.get('/api/auth/sso/status', (req, res) => {
  if (req.ssoUser) {
    res.json({
      authenticated: true,
      userId: req.ssoUser.id,
      name: req.ssoUser.name,
      permissions: req.ssoUser.permissions,
    });
  } else {
    res.json({ authenticated: false });
  }
});
```

### 3. 在受保护的路由中使用

```typescript
// 需要认证的路由
router.get('/secure/data', (req, res) => {
  if (!req.ssoUser) {
    return res.status(401).json({ error: '请先登录' });
  }
  res.json({ data: '受保护内容', user: req.ssoUser });
});

// 或使用 ssoRequired 中间件
router.get('/secure/data', ssoRequired, (req, res) => {
  res.json({ data: '受保护内容', user: req.ssoUser });
});

// 权限控制
router.post('/admin/action', ssoRequirePermission('admin'), (req, res) => {
  res.json({ success: true });
});
```

### 4. 添加依赖

```bash
npm install jsonwebtoken @types/jsonwebtoken
```

如果使用 TypeScript，确认 `tsconfig.json` 的 `compilerOptions` 包含：

```json
{
  "compilerOptions": {
    "typeRoots": ["./node_modules/@types"]
  }
}
```

### 5. 配置环境变量

```bash
# .env 或 docker-compose.yml
SSO_JWT_SECRET=<与 ADC 的 JWT_SECRET_SSO 保持一致>
```

## 验证集成

启动服务后验证：

```bash
# 1. 获取 Agent JWT
curl -X POST http://adc-host/api/auth/agent/login \
  -H "Content-Type: application/json" \
  -d '{"agentId":"cto-agent","token":"agent_xxx..."}'

# 2. 用 JWT 访问你的服务
curl http://your-service/api/auth/sso/status \
  -H "Authorization: Bearer <jwt-from-step-1>"

# 3. 无 token 访问
curl http://your-service/api/auth/sso/status
# → { authenticated: false }
```

## 权限矩阵

| 角色 | 默认权限 |
|------|---------|
| admin-agent | `admin` |
| manager-agent | `todo:read`, `todo:write`, `requirement:read`, `requirement:write`, `marketplace:read`, `marketplace:write` |
| dev-agent | `todo:read`, `todo:write`, `requirement:read`, `marketplace:read`, `marketplace:claim` |
| viewer-agent | `todo:read`, `requirement:read`, `marketplace:read` |

## 最佳实践

1. **优先用非阻塞模式** — `ssoAuth` 不影响未登录用户，适合公开页面也展示登录态
2. **敏感操作加权限守卫** — `ssoRequirePermission('admin')` 做精细化控制
3. **不要 query param 传 token** — 仅用 Authorization header（安全审计要求）
4. **SSO_JWT_SECRET 不要硬编码** — 通过环境变量注入
5. **SSO_JWT_SECRET 统一** — 所有服务用同一个值，与 ADC 的 JWT_SECRET_SSO 一致
