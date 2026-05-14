# LLM Todo SSO 接入指南

## 概述

本文档说明如何将 LLM Todo 服务接入 SSO 统一登录系统。

## 接入步骤

### 1. 配置共享密钥

在 LLM Todo 的 `.env` 中添加：

```env
# SSO 配置 — 必须与 Agent Dev Center 后端的 JWT_SECRET 一致
SSO_JWT_SECRET=your-shared-jwt-secret-here
SSO_AUTH_GATEWAY=http://8.163.44.127/api/auth/sso/verify
```

### 2. 添加 SSO 中间件

在 `src/middleware/sso-auth.ts` 中创建：

```typescript
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const SSO_JWT_SECRET = process.env.SSO_JWT_SECRET || '';

if (!SSO_JWT_SECRET) {
  console.warn('⚠️  SSO_JWT_SECRET not configured, SSO will not work');
}

export interface SsoUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      ssoUser?: SsoUser;
    }
  }
}

/**
 * SSO 认证中间件
 *
 * 支持三种 token 传递方式：
 * 1. Authorization: Bearer <token>
 * 2. Query param: ?token=<token>
 * 3. Cookie: sso_token=<token>
 */
export function ssoAuth(req: Request, res: Response, next: NextFunction) {
  if (!SSO_JWT_SECRET) {
    return next(); // 未配置 SSO，跳过
  }

  const token =
    req.header('authorization')?.replace(/^Bearer\s+/i, '') ??
    (req.query.token as string | undefined) ??
    req.cookies?.sso_token;

  if (!token) {
    return next(); // 无 token，不注入用户（公开访问）
  }

  try {
    const payload = jwt.verify(token, SSO_JWT_SECRET) as { sub: string };
    // 注意：这里只解析 token，不查数据库（轻量验证）
    // 如果需要完整用户信息，调用 SSO_AUTH_GATEWAY/verify
    req.ssoUser = {
      id: payload.sub,
      name: '',     // 从 token 无法直接获取
      email: '',    // 需要调用 verify 或扩展 token payload
      role: '',
    };
  } catch {
    // token 无效，忽略
  }

  next();
}

/**
 * SSO 必须认证中间件（要求 token 有效）
 */
export function ssoRequired(req: Request, res: Response, next: NextFunction) {
  if (!SSO_JWT_SECRET) {
    return next();
  }

  const token =
    req.header('authorization')?.replace(/^Bearer\s+/i, '') ??
    (req.query.token as string | undefined);

  if (!token) {
    return res.status(401).json({ error: '请先通过 SSO 登录' });
  }

  try {
    const payload = jwt.verify(token, SSO_JWT_SECRET) as { sub: string };
    req.ssoUser = { id: payload.sub, name: '', email: '', role: '' };
    next();
  } catch {
    return res.status(401).json({ error: 'SSO Token 无效或已过期' });
  }
}
```

### 3. 在应用中使用

修改 `src/index.ts`：

```typescript
import { ssoAuth } from './middleware/sso-auth.js';

// 在路由之前添加 SSO 中间件
app.use(ssoAuth);

// API 路由（ssoAuth 会注入 req.ssoUser，但不强制要求登录）
app.use('/api/todos', todoRouter);
app.use('/api/chat', chatRouter);
app.use('/api/agent', agentRouter);
```

### 4. 前端跳转

从 Agent Dev Center SSO Portal 跳转到 LLM Todo 时，URL 会自动携带 token：

```
http://8.163.44.127/todo/?token=eyJhbGciOiJIUzI1NiIs...
```

前端 JavaScript 提取 token：

```javascript
// public/app.js 中添加
function getSsoToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    localStorage.setItem('sso_token', token);
    // 清除 URL 中的 token（安全）
    window.history.replaceState({}, '', window.location.pathname);
  }
  return token || localStorage.getItem('sso_token');
}

// API 调用时自动携带
async function apiFetch(url, options = {}) {
  const token = getSsoToken();
  if (token) {
    options.headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
    };
  }
  return fetch(url, options);
}
```

## 验证接入

```bash
# 1. 在 Agent Dev Center 登录获取 token
TOKEN=$(curl -s -X POST http://8.163.44.127/api/auth/sso/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@agent.dev","password":"PASSWORD_REMOVED_BY_SECURITY_CLEANUP"}' | jq -r '.accessToken')

# 2. 用 token 访问 LLM Todo
curl -s http://localhost:3458/api/health \
  -H "Authorization: Bearer $TOKEN"

# 或通过 query param
curl -s "http://localhost:3458/api/health?token=$TOKEN"
```

## 安全注意事项

1. **HTTPS Only** — 生产环境必须用 HTTPS 传输 token
2. **Token 清理** — 前端应从 URL 中移除 token（避免泄露到日志）
3. **共享密钥** — JWT_SECRET 必须与 Auth Gateway 一致
4. **过期处理** — 前端检测 401 后跳转回登录页
