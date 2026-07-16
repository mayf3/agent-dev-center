# SSO 统一登录策略 — 技术方案

## 1. 目标

在 Agent Dev Center 已有 JWT 认证系统基础上，扩展为统一认证网关，让所有接入服务共享同一套登录态。

## 2. 架构设计

### 2.1 核心思路

**不引入新服务**，而是将 agent-dev-center 后端作为认证中心（Auth Gateway），其他服务通过验证其签发的 JWT 实现互通。

```
用户 → 登录 Agent Dev Center → 获得 JWT
  ↓
携带 JWT 访问 LLM Todo → 验证通过 → 自动创建/匹配本地用户
  ↓
携带 JWT 访问 Wiki 系统 → 验证通过 → 识别身份
```

### 2.2 新增 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/sso/login` | POST | SSO 登录（兼容原有 /login，额外返回 serviceUrls） |
| `/api/auth/sso/verify` | GET | 第三方服务验证 token 有效性，返回用户信息 |
| `/api/auth/sso/token` | POST | 为指定服务签发带 scope 的 service token |

### 2.3 Token 机制

**不改变现有 JWT 结构**，仅扩展：

1. **Access Token**（已有）：`{ sub: userId }`，2h 过期
2. **Refresh Token**（已有）：`{ sub: userId }`，7d 过期
3. **Service Token**（新增）：`{ sub: userId, scope: serviceName }`，24h 过期
   - 用于服务间调用，限制只能访问特定服务
   - 可选功能，第一版不实现

### 2.4 验证中间件

提供 `ssoVerify` 中间件，第三方服务可以：

1. 配置 Auth Gateway 的公钥或共享密钥
2. 验证 JWT 签名
3. 提取用户信息
4. 可选：调用 `/api/auth/sso/verify` 在线验证

## 3. 实现计划

### Day 1（今天）

1. **后端 SSO 端点**：
   - `POST /api/auth/sso/login` — 登录 + 返回服务列表（含各服务 URL）
   - `GET /api/auth/sso/verify` — 验证 token，返回用户信息（给第三方服务调用）
   - `POST /api/auth/sso/token` — 为特定服务签发 scoped token

2. **SSO 中间件**：
   - `ssoAuth` — 兼容原有 `authRequired`，额外支持 query param token
   - `ssoCors` — 允许跨服务携带 cookie/token

3. **Nginx 配置参考**：
   - 统一注入 token 到 cookie
   - 跨服务转发时携带 Authorization header

### Day 2

4. **前端 SSO 入口**：
   - 统一登录页（现有 /login 已满足）
   - 登录后跳转到目标服务（带 token）
   - Portal 页面：列出所有服务，一键跳转

5. **LLM Todo 接入示例**：
   - 配置共享 JWT_SECRET
   - 添加 ssoVerify 中间件
   - 前端跳转携带 token

### Day 3

6. **测试 + 文档 + 验收报告**

## 4. 约束遵守

- ✅ 不改现有 API 接口签名（/auth/login, /auth/register, /auth/refresh 保持不变）
- ✅ 不新增数据库 schema（复用 users 表）
- ✅ 不新增依赖（已有 jsonwebtoken + bcrypt）
- ✅ 先写 spec 再写代码

## 5. 服务接入规范

### 5.1 接入步骤

1. 在服务注册中心注册服务（已有）
2. 配置共享 JWT_SECRET（环境变量）
3. 添加 SSO 验证中间件
4. 配置 Nginx 转发

### 5.2 验证方式

**方式一：共享密钥（推荐）**
- 各服务配置相同的 JWT_SECRET
- 本地验证 JWT 签名，无需网络请求
- 性能最好

**方式二：在线验证**
- 调用 Auth Gateway 的 `/api/auth/sso/verify`
- 适合不能共享密钥的场景
- 每次请求多一次网络调用

### 5.3 Token 传递方式

1. **Authorization Header**（推荐）：`Bearer <token>`
2. **Query Parameter**：`?token=<token>`（SSO 跳转场景）
3. **Cookie**：`sso_token=<token>`（Nginx 可选配置）

## 6. 安全考量

- JWT_SECRET 生产环境必须强密钥（已有校验）
- HTTPS Only（生产环境）
- Token 过期后必须 refresh 或重新登录
- SSO verify 端点需要认证（用 gateway 内部密钥）
