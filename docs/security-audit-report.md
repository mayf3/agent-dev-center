# 🔒 Agent Dev Center — 安全审查报告

| 项目 | 值 |
|------|-----|
| **项目名称** | Agent Dev Center（需求驱动的开发管理平台） |
| **审查日期** | 2026-05-09 |
| **审查人** | security-agent |
| **部署地址** | http://{your-server-ip} |
| **技术栈** | Node.js + TypeScript + Express + PostgreSQL + React + Ant Design |
| **审查范围** | 认证授权、API 安全、Docker 配置、依赖安全、数据安全 |
| **审查结果** | ⚠️ **不通过** — 3 个严重问题阻塞生产部署 |

---

## 一、审查结果概览

| 严重程度 | 数量 | 状态 |
|----------|------|------|
| 🔴 严重 (Critical) | 3 | 阻塞上线，必须立即修复 |
| 🟡 中等 (Medium) | 7 | 上线后尽快修复 |
| 🟢 低 (Low) | 6 | 后续优化 |

### 总结

项目基础安全做得不错：Prisma ORM 防注入、bcrypt 密码哈希、Zod 输入校验、Docker 网络隔离和非 root 运行都到位了。但存在 **3 个严重漏洞**（注册可获 admin 权限、密钥明文存于 git、无 HTTPS 加密），必须在生产部署前修复。

---

## 二、依赖漏洞扫描

### npm audit

**2 个高危漏洞（均为间接依赖 `tar`）**

| 包 | 严重级别 | CVE/Advisory | 影响范围 |
|----|---------|-------------|---------|
| tar | 🔴 HIGH | GHSA-34x7-hfp2-rc4v | 任意文件创建/覆写（硬链接路径穿越）|
| tar | 🔴 HIGH | GHSA-8qq5-rm4j-mr97 | 符号链接投毒导致任意文件覆写 |
| tar | 🔴 HIGH | GHSA-83g3-92jg-28cx | 硬链接目标逃逸（符号链接链） |
| tar | 🔴 HIGH | GHSA-qffp-2rhf-9h96 | 驱动器相对路径穿越 |
| tar | 🔴 HIGH | GHSA-9ppj-qmqm-q256 | 符号链接路径穿越（驱动器相对） |
| tar | 🔴 HIGH | GHSA-r6q2-hw4h-h46w | macOS APFS Unicode 竞态条件 |

**修复命令：**
```bash
npm update tar
npm audit fix
```

> `tar` 是 npm 的间接依赖，升级 npm 到最新版（≥10.9.x）通常可解决。

**其余依赖**（express, bcrypt, jsonwebtoken, zod, prisma, axios, react, antd 等）无已知漏洞。

---

## 三、严重问题（🔴 Critical — 阻塞上线）

### C1. 注册接口允许自选 admin 角色

- **文件：** `backend/src/schemas/auth.ts` L15, `backend/src/routes/auth.ts` L23
- **严重程度：** 🔴 Critical
- **描述：** 注册 API 的 `role` 字段接受 `admin` 值，任何人可以通过注册接口直接获得管理员权限，完全绕过权限控制体系。
- **复现步骤：**
  1. POST `/api/auth/register`，body: `{ "name": "hacker", "email": "hacker@evil.com", "password": "12345678", "role": "admin" }`
  2. 返回 token，拥有 admin 权限
- **影响：** 任意用户可获取完整管理员权限，查看/修改所有数据
- **修复建议：**
  ```typescript
  // backend/src/schemas/auth.ts — 移除 admin 选项
  role: z.enum(['requester', 'developer']).default('requester')
  ```
  或增加管理员邀请码机制。
- **当前代码：**
  ```typescript
  // auth.ts
  role: z.enum(['admin', 'requester', 'developer']).default('requester')
  ```

### C2. .env.production 硬编码密码且被 git 跟踪

- **文件：** `.env.production`
- **严重程度：** 🔴 Critical
- **描述：** 生产环境密钥文件包含明文的 JWT_SECRET、数据库密码，且文件未被 `.gitignore` 排除（`.dockerignore` 已排除但 `.gitignore` 未排除 `.env.production`）。
- **暴露信息：**
  ```
  JWT_SECRET=a3623631eda940022dcf5e039f762ddd6259b9e454730b1e65a28a3bc858b3a4
  POSTGRES_PASSWORD={your-db-password}
  DATABASE_URL=postgresql://agent_dev:{your-db-password}@postgres:5432/agent_dev_center
  ```
- **影响：** 密钥泄露到 git 历史，任何有仓库访问权的人可获取生产凭据
- **修复建议：**
  1. 将 `.env.production` 加入 `.gitignore`：
     ```bash
     echo '.env.production' >> .gitignore
     ```
  2. 从 git 历史中清除（如已提交）：
     ```bash
     git filter-branch --force --index-filter \
       "git rm --cached --ignore-unmatch .env.production" --prune-empty -- --all
     ```
  3. **立即轮换** JWT_SECRET 和数据库密码
  4. 使用 CI/CD secrets 或 Vault 注入敏感配置

### C3. 无 HTTPS/TLS 加密

- **文件：** `nginx-site.conf`, `docker-compose.prod.yml`
- **严重程度：** 🔴 Critical
- **描述：** 所有 HTTP 流量为明文传输，包括 JWT Token、登录密码、业务数据。在公网环境下可被中间人截获。
- **影响：** Token 被窃取后可完全接管用户会话
- **修复方案 A — Let's Encrypt + Nginx（推荐，有域名时）：**
  ```nginx
  server {
      listen 443 ssl http2;
      server_name your-domain.com;

      ssl_certificate /etc/nginx/ssl/fullchain.pem;
      ssl_certificate_key /etc/nginx/ssl/privkey.pem;
      ssl_protocols TLSv1.2 TLSv1.3;
      ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
      ssl_prefer_server_ciphers off;

      add_header Strict-Transport-Security "max-age=63072000" always;

      # ... 其余配置同现有 nginx-site.conf
  }

  server {
      listen 80;
      server_name your-domain.com;
      return 301 https://$server_name$request_uri;
  }
  ```
  使用 certbot 自动续期：
  ```bash
  apt-get install certbot
  certbot certonly --standalone -d your-domain.com
  ```

- **修复方案 B — Tailscale HTTPS（内网方案）：**
  ```bash
  tailscale cert your-host.tailnet-name.ts.net
  ```

---

## 四、中等问题（🟡 Medium — 尽快修复）

### M1. 权限校验基于 user.name 而非 user.id

- **文件：** `backend/src/routes/requirements.ts` — `canReadRequirement()`, `canEditRequirement()`
- **描述：** 使用 `user.name` 匹配 `requirement.requester`/`assignee`，名称可重复或被修改，存在越权或误判风险。
- **修复建议：** 需求表存储 `requesterId`（UUID）代替 `requester`（name 字符串），权限匹配基于 ID。

### M2. 登录/注册接口无速率限制

- **文件：** `backend/src/app.ts`
- **描述：** 登录、注册等敏感接口无 rate limiting，可被暴力破解密码。
- **修复建议：**
  ```typescript
  import rateLimit from 'express-rate-limit';

  app.use('/api/auth', rateLimit({
    windowMs: 15 * 60 * 1000, // 15 分钟
    max: 10,                   // 最多 10 次请求
    standardHeaders: true,
    legacyHeaders: false,
    message: '请求过于频繁，请稍后再试'
  }));
  ```
  安装：`npm install express-rate-limit`

### M3. JWT 有效期 7 天且无刷新机制

- **文件：** `backend/src/middleware/auth.ts`, `.env.production`
- **描述：** Token 7 天才过期，无 refresh token，一旦泄露攻击窗口很大。
- **修复建议：**
  - Access token 缩短为 1-2 小时
  - 增加 refresh token 机制（7 天有效）
  - 支持 token 黑名单/撤销

### M4. Seed 脚本硬编码弱密码

- **文件：** `backend/prisma/seed.ts`
- **描述：** `PASSWORD_REMOVED_BY_SECURITY_CLEANUP`, `requester123`, `developer123` — 若在生产环境执行会创建弱密码账户。
- **修复建议：**
  ```typescript
  if (process.env.NODE_ENV === 'production') {
    console.log('Skipping seed in production');
    process.exit(0);
  }
  ```

### M5. CORS 配置可能过于宽松

- **文件：** `backend/src/app.ts`
- **描述：** 当 `FRONTEND_ORIGIN` 为 `*` 时，`origin: true` 允许任何来源的跨域请求。
- **修复建议：** 生产环境强制指定精确域名，禁止通配符。

### M6. 通知 URL 无校验（SSRF 风险）

- **文件：** `backend/src/utils/notifications.ts`
- **描述：** `FEISHU_WEBHOOK_URL` 和 `AGENT_CALLBACK_URL` 从环境变量读取后直接 fetch，可被利用进行 SSRF 攻击。
- **修复建议：** 校验 URL scheme（仅允许 `https://`），或使用白名单机制。

### M7. Frontend 容器以 root 运行

- **文件：** `frontend/Dockerfile`
- **描述：** Nginx 默认以 root 进程运行，容器被攻破后获得 root 权限。
- **修复建议：**
  ```dockerfile
  # 在 frontend/Dockerfile 末尾添加
  RUN chown -R nginx:nginx /usr/share/nginx/html && \
      chown -R nginx:nginx /var/cache/nginx && \
      chown -R nginx:nginx /var/log/nginx && \
      touch /var/run/nginx.pid && \
      chown -R nginx:nginx /var/run/nginx.pid
  USER nginx
  ```

---

## 五、低优先级问题（🟢 Low — 后续优化）

### L1. 安全响应头不完整

- **文件：** `nginx-site.conf`
- **描述：** 缺少 `Content-Security-Policy`、`Permissions-Policy`、`Strict-Transport-Security`（需配合 HTTPS）。
- **建议添加：**
  ```nginx
  add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
  add_header Strict-Transport-Security "max-age=63072000" always;
  ```

### L2. Docker 镜像版本未精确锁定

- **文件：** `docker-compose.prod.yml`
- **描述：** `postgres:16-alpine`、`redis:7-alpine`、`node:20-alpine` 使用大版本号，可能意外升级。
- **建议：** 锁定到具体补丁版本，如 `postgres:16.4-alpine3.20`。

### L3. 数据库无备份策略

- **描述：** PostgreSQL 无定时备份，数据丢失风险。
- **建议：** 添加 cron 定时备份：
  ```bash
  # 每天 3:00 备份
  0 3 * * * docker exec agent-dev-center-postgres pg_dump -U agent_dev agent_dev_center | gzip > /backup/db_$(date +\%Y\%m\%d).sql.gz
  # 保留 30 天
  0 4 * * * find /backup -name "*.sql.gz" -mtime +30 -delete
  ```

### L4. 无集中日志收集

- **描述：** Docker 日志轮转已配置（json-file, 10m×3），但无集中收集。
- **建议：** 后续接入 ELK 或 Loki + Grafana。

### L5. 密码策略偏弱

- **文件：** `backend/src/schemas/auth.ts`
- **描述：** 注册仅要求 8 位最小长度，无复杂度要求。
- **建议：** 添加密码复杂度校验（大小写+数字+特殊字符）。

### L6. 邮箱等个人信息明文存储

- **描述：** 用户邮箱未加密存储在数据库中。
- **建议：** 评估是否需要对邮箱等 PII 进行加密存储，取决于数据合规要求。

---

## 六、安全审查 — 做得好的部分 ✅

| 检查项 | 状态 | 说明 |
|--------|------|------|
| SQL 注入防护 | ✅ | 全部使用 Prisma ORM 参数化查询，无原生 SQL |
| XSS 防护 | ✅ | React 默认转义 HTML，未使用 dangerouslySetInnerHTML |
| CSRF 防护 | ✅ | JWT Bearer Token（非 Cookie），天然防 CSRF |
| 输入验证 | ✅ | 全部 API 使用 Zod schema 校验 |
| 密码存储 | ✅ | bcrypt 哈希，salt rounds=10 |
| 错误处理 | ✅ | 统一 error handler，生产环境不暴露堆栈 |
| 请求追踪 | ✅ | 每个请求分配 UUID（x-request-id） |
| 优雅关闭 | ✅ | SIGINT/SIGTERM 处理完善，数据库连接正确关闭 |
| Docker 非 root | ✅ | Backend 容器使用 app 用户运行 |
| Docker 网络隔离 | ✅ | Backend 网络设为 `internal: true`，DB/Redis 不暴露公网 |
| Docker 日志轮转 | ✅ | json-file, max-size=10m, max-file=3 |
| Docker 安全选项 | ✅ | `security_opt: no-new-privileges:true` |
| Healthcheck | ✅ | 所有服务配置了健康检查 |
| 多阶段构建 | ✅ | Backend/Frontend 均使用多阶段构建，生产镜像精简 |
| Init 进程 | ✅ | Backend 使用 tini 作为 PID 1 |
| Nginx 安全头 | ✅ | X-Frame-Options, X-Content-Type-Options, Referrer-Policy |
| Nginx server_tokens | ✅ | 已关闭版本号显示 |

---

## 七、修复优先级路线图

### Phase 1 — 上线前必须完成（🔴）

| # | 问题 | 负责人 | 预估工时 |
|---|------|--------|---------|
| C1 | 注册接口移除 admin 角色 | 后端 | 30min |
| C2 | .env.production 从 git 移除 + 密钥轮换 | 运维 | 1h |
| C3 | 配置 HTTPS (TLS) | 运维 | 2h |
| M2 | 添加登录/注册速率限制 | 后端 | 30min |

### Phase 2 — 上线后 1 周内（🟡）

| # | 问题 | 负责人 | 预估工时 |
|---|------|--------|---------|
| M4 | Seed 脚本生产环境跳过 | 后端 | 15min |
| M1 | 权限匹配改用 user.id | 后端 | 4h（需改 schema） |
| M3 | JWT 有效期缩短 + refresh token | 后端 | 3h |
| M7 | Frontend 容器非 root | 运维 | 30min |
| M5 | CORS 精确配置 | 后端 | 15min |
| M6 | 通知 URL 白名单校验 | 后端 | 1h |

### Phase 3 — 后续优化（🟢）

| # | 问题 | 负责人 | 预估工时 |
|---|------|--------|---------|
| L1 | 补全安全响应头 | 运维 | 30min |
| L2 | Docker 镜像版本锁定 | 运维 | 30min |
| L3 | 数据库备份策略 | 运维 | 1h |
| L5 | 密码复杂度校验 | 后端 | 30min |
| L4 | 集中日志收集 | 运维 | 4h |
| L6 | PII 加密存储评估 | 后端 | 2h |
| — | npm audit 修复 tar 漏洞 | 后端 | 15min |

---

## 八、附录：审查方法

- **依赖扫描：** `npm audit --json`（本地执行）
- **代码审查：** 逐文件人工审查全部 backend/src 和 frontend/src 源码
- **配置审查：** Dockerfile、docker-compose（dev + prod）、nginx-site.conf、deploy.sh、.env.example、.env.production
- **数据库审查：** Prisma schema + seed 脚本
- **服务器安全：** 此前已对 {your-server-ip} 服务器做过 OS 级安全评估（见 itops-agent 相关记录）

---

*报告生成时间：2026-05-09 12:45 CST*
*审查人：security-agent*
