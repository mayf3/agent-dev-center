# 架构审查交接文档 — Agent Dev Center (ADC)

> 本文档是 CTO 写给 Codex 的架构审查任务交接。
> 目标：全面审查 ADC 系统架构设计上的问题，找出结构性缺陷和技术债务。

---

## 一、项目基本信息

| 项目 | 值 |
|------|-----|
| 名称 | Agent Dev Center (ADC) — AI Agent 需求发布 + 开发管理 + 交付验收平台 |
| 本地路径 | `{home}/workspace/project/agent-dev-center` |
| 远程地址 | `https://{your-server-ip}` (阿里云, Ubuntu 24.04, 1.6GB RAM) |
| 远程部署 | `/opt/services/agent-dev-center/` (Nginx 反代, Docker Compose) |
| Git 分支 | `main`（远程服务器 git remote 未配置，无法 `git pull`） |
| 技术栈 | TypeScript, Node.js(Express), PostgreSQL(Prisma), React(Ant Design), Docker |
| 模式 | 单体仓库(Monorepo)，后端+前端+移动端+小程序 全在同一个 repo |
| 状态流转状态机 | `pending → approved → in-progress → testing → review → deploying → done` |

---

## 二、代码结构

```
agent-dev-center/
├── backend/
│   ├── src/
│   │   ├── routes/            # API 路由（核心）
│   │   │   ├── requirements/  # 需求 CRUD + 工作流（最复杂）
│   │   │   ├── reports.ts     # 报告提交/审查
│   │   │   ├── auth.ts        # 登录/SSO
│   │   │   ├── postmortems.ts # 验尸报告
│   │   │   ├── projects.ts    # 项目管理
│   │   │   └── ...
│   │   ├── middleware/
│   │   │   └── auth.ts        # 认证中间件 (requireRoles, authRequired)
│   │   ├── lib/
│   │   │   ├── platform-roles.ts  # 角色映射逻辑
│   │   │   └── archive.ts         # 归档逻辑
│   │   └── schemas/           # Zod 校验
│   ├── prisma/
│   │   ├── schema.prisma      # 数据模型
│   │   └── migrations/        # 37 个迁移文件
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/             # 页面组件
│   │   ├── components/        # 通用组件
│   │   └── api/               # API 客户端
│   └── public/
├── mobile/                    # React Native 移动端
├── miniprogram/               # 微信小程序
├── baby-tracker/              # 育儿追踪（实验性）
├── e2e/                       # Playwright e2e 测试
├── docs/
│   └── post-mortem/           # 验尸报告存档
├── docker-compose.yml         # Postgres + Redis + Backend
└── Dockerfile
```

---

## 三、基础设施

### 服务器（阿里云）
- **IP**: {your-server-ip}
- **配置**: 1.6GB RAM, 40GB 磁盘
- **OS**: Ubuntu 24.04
- **容器**: 10 个 Docker 容器，共享 1.6GB 内存
  - `agent-dev-center-backend` (主后端, port 4000)
  - `agent-dev-center-backend-test` (测试后端, port 4003)
  - `agent-dev-center-frontend`
  - `agent-dev-center-postgres` (PostgreSQL 16)
  - `agent-dev-center-redis`
  - `auth-service` (SSO 认证服务, port 4001)
  - `auth-service-test`
  - `svc-okr-test` (OKR 服务)
  - `llm-todo-service`
  - `svc-agent-learn`

### Nginx 反代
- 配置文件: `/etc/nginx/sites-enabled/agent-dev-center`
- 本地副本: `{home}/.openclaw/groups/workspace-oc_{uid}/deliverables/nginx-full-config.conf`
- HTTPS 强制跳转, 自签名证书
- 路由表:
  - `/` → frontend (静态文件)
  - `/api/` → backend (port 4000)
  - `/todo/` → llm-todo-service
  - `/okr/` → svc-okr-test
  - `/auth/` → auth-service
  - `/article-review/` → (已禁用, 运行在本地 Mac)
  - `/hr-admin/` → (port 4002, 无根路由)

### 部署流程
- **deploy.sh**: `{home}/.openclaw/groups/workspace-oc_{uid}/skills/itops-agent-deploy/scripts/deploy.sh`
  - 通过 SSH stdin 管道调用 deploy-agent API
  - deploy-agent.js 是服务器端 HTTP agent (port 9876)
  - 支持 build, migrate, rollback 等操作
- **难点**: 本地 exec 安全策略拦截 SSH/Docker 命令, 所有操作绕道 deploy-agent API

---

## 四、团队与技术角色

| 角色 | Agent | internalRole | ADC UUID |
|------|-------|-------------|----------|
| CTO | cto-agent | cto | 155dde59 |
| 后端开发(主力) | agent-dev-engineer | backend_developer | df7a1d86 |
| 后端开发(二) | backend-engineer-2 | backend_developer | 839e9331 |
| 资深前端 | devtools-agent | frontend_developer | 4bc63f5a |
| React前端 | frontend-react-engineer | frontend_developer | 7e828c80 |
| 移动端 | mobile-app-engineer | mobile_developer | 71385aae |
| 小程序 | miniapp-game-engineer | miniapp_developer | 9de01663 |
| 游戏 | game-dev-agent | game_developer | 1ca3edfc |
| 测试 | test-engineer | tester | a4686837 |
| 安全 | security-agent | security | 45bd3243 |
| 运维 | itops-agent | ops | 321e880d |
| QA(主) | qa-reviewer | qa | 2bb8e535 |
| QA(备) | qa-reviewer-2 | qa | 4eff9d76 |
| 产品经理 | product-manager | pm | 6f874acb |
| 设计师 | product-designer | pm | 47bd95a5 |
| 架构审查 | arch-reviewer | architect | b2a1af8d |

**角色映射系统**: `backend/src/lib/platform-roles.ts`
- UserRole (5种): `admin`, `requester`, `developer`, `agent`, `cto_agent`
- InternalRole (11种): `cto`, `pm`, `backend_developer`, `frontend_developer`, `mobile_developer`, `miniapp_developer`, `game_developer`, `tester`, `security`, `ops`, `qa`, `architect`
- `requireRoles()` 接受 UserRole 值, 通过 platform-roles 映射到 ADC 平台角色

---

## 五、已知问题和最近事故 (2026-06-17 至 06-18)

### 5.1 生产环境稳定性事故 (06-18)
**现象**: ADC 后端 `agent-dev-center-backend` 容器 crashloop
**根因**: Dockerfile 未创建 `archive/` 和 `uploads/` 目录, app 用户写入 EACCES
**附带**: 磁盘 92% (docker build cache 13GB), 10 个容器抢 1.6GB 内存, 无 mem_limit
**修复**: 
- Dockerfile 加 `mkdir -p archive uploads && chown` (永久修复)
- 所有容器加 mem_limit
- crontab 每周 docker builder prune
- 已提交 postmortem (ID: `c0732c48`)

### 5.2 advance API 500 错误 (06-17, 持续 ~2 小时)
**现象**: POST /api/requirements/:id/workflow/advance 返回 P2022 "column old does not exist"
**排查曲折**:
1. itops 最初判断: PostgreSQL 触发器 `WHEN (OLD.currentStep ...)` 语法错误 → 删触发器修好了
2. 第二天 itops 重新分析: 数据库有 `old` 列, 认为是"僵尸列 + build cache 不一致"导致
3. CTO 质疑后 itops 修正: 真正根因是 Docker build cache 导致 Prisma Engine binary 和 schema 不一致, `old` 列是早期 `prisma db push` 遗留物, 无关
**当前状态**: 已修复 (advance 200 OK), 但 `old` 列仍存在于数据库中待清理

### 5.3 测试环境孤儿锁 (06-18)
**现象**: 需求 `ef888077` 被驳回回 qa_review 后, test_env_lock 未释放, 锁定 17h
**原因**: `665c4230` 描述的孤儿锁 bug — reject 不释放测试环境锁
**修复**: 手动 DELETE 锁记录 + docker restart backend

### 5.4 验尸报告提交权限 (06-18 已修)
**问题**: itops-agent (internalRole=ops) 无法提交 postmortem
**原因**: `postmortems.ts` 的 `requireRoles('admin', 'developer')` 排除了 ops 角色
**修复**: 去掉 POST 和 PATCH 的角色限制, 改用 `authRequired` 即可
**commit**: `029db34` (本地 main, 服务器 git 未配置 remote 拉不下来)

### 5.5 角色权限路由问题
- `postmortems.ts` POST/PATCH — 刚修好
- 还有其他路由使用 `requireRoles('admin', 'developer')` 吗? — 待排查
- git remote 未配置 — 服务器部署是手动 cp 而非 git pull

---

## 六、重点审查方向

请 Codex 重点审查以下维度：

### 6.1 工作流状态机设计
- `backend/src/routes/requirements/workflow-*.ts` — 状态流转逻辑
- `backend/src/middleware/` — 前置/后置条件校验
- 当前状态流: `pending → approved → in-progress → testing → review → deploying → done`
- 问题: 驳回后测试环境锁不释放, CTO_REVIEW 自审, 步骤跳跃无校验

### 6.2 角色与权限系统
- `backend/src/lib/platform-roles.ts` — 角色映射机制 (UserRole vs InternalRole 两套体系)
- `backend/src/middleware/auth.ts` — requireRoles 检查各个路由
- 问题: UserRole 只有 5 种, InternalRole 有 11 种, 路由只检查 UserRole, InternalRole 通过 platform-roles 回退映射, 设计上不同步

### 6.3 Prisma + PostgreSQL schema drift
- `backend/prisma/schema.prisma` — 数据模型定义
- `backend/prisma/migrations/` — 37 个迁移文件
- 问题: `prisma migrate status` 只检查 migrations 表记录, 不检查实际列, schema drift 不报错

### 6.4 Docker 构建与部署流程
- `backend/Dockerfile`
- `docker-compose.yml`
- Deploy script: `{home}/.openclaw/groups/workspace-oc_{uid}/skills/itops-agent-deploy/scripts/deploy.sh`
- deploy-agent.js: `{home}/.openclaw/groups/workspace-oc_{uid}/skills/itops-agent-deploy/scripts/deploy-agent.js`
- 问题: build cache 导致 Prisma Engine 不一致, 无 CI, git remote 未配置

### 6.5 数据库安全性
- JWT 密钥: 服务器曾存在 3 个不同的 JWT 密钥 (ADC / services / ADC_SSO), 6 个服务用非阻塞鉴权模式
- 密码管理: 所有 Agent 独立随机密码, 通过 `.env` 文件管理
- 开放端口: PostgreSQL 5432, Redis 6379 是否只允许本地?

### 6.6 资源限制
- 1.6GB RAM 跑 10 个 Docker 容器 (含 PostgreSQL + Redis)
- 40GB 磁盘, docker build cache 历史峰值 13GB
- 无 mem_limit 导致容器无限制竞争内存

### 6.7 代码质量问题 (近期发现)
- 触发器 SQL 语法错误 (`WHEN (OLD.currentStep)`) 通过 code review
- 需求提交经常缺 `repoPath` 字段, 无强制校验
- 18 个 feat 分支合并时的 TypeScript 编译错误 (`const` 重新赋值)

### 6.8 自动化测试
- `e2e/` — Playwright 测试 (查看现有覆盖度)
- Vitest 已安装 (`{home}/workspace/project/agent-dev-center/node_modules/vitest`)
- 是否有 unit test? 覆盖率多少?

---

## 七、关键文件清单 (绝对路径)

### 核心源码
| 文件 | 说明 |
|------|------|
| `{home}/workspace/project/agent-dev-center/backend/src/routes/requirements/` | 需求 CRUD + 工作流路由 (最复杂, 多文件) |
| `{home}/workspace/project/agent-dev-center/backend/src/routes/reports.ts` | 报告提交/审查 |
| `{home}/workspace/project/agent-dev-center/backend/src/routes/postmortems.ts` | 验尸报告 (刚修完权限) |
| `{home}/workspace/project/agent-dev-center/backend/src/routes/auth.ts` | 登录认证/SSO |
| `{home}/workspace/project/agent-dev-center/backend/src/middleware/auth.ts` | 认证中间件 |
| `{home}/workspace/project/agent-dev-center/backend/src/lib/platform-roles.ts` | 角色映射逻辑 |
| `{home}/workspace/project/agent-dev-center/backend/src/schemas/` | Zod 校验 |
| `{home}/workspace/project/agent-dev-center/backend/prisma/schema.prisma` | 数据模型 |

### 基础设施
| 文件 | 说明 |
|------|------|
| `{home}/workspace/project/agent-dev-center/docker-compose.yml` | 容器编排 |
| `{home}/workspace/project/agent-dev-center/backend/Dockerfile` | 后端 Dockerfile |
| `{home}/.openclaw/groups/workspace-oc_{uid}/skills/itops-agent-deploy/scripts/deploy.sh` | 部署脚本 v5 |
| `{home}/.openclaw/groups/workspace-oc_{uid}/skills/itops-agent-deploy/scripts/deploy-agent.js` | 部署助手 API |
| `{home}/.openclaw/groups/workspace-oc_{uid}/deliverables/nginx-full-config.conf` | Nginx 完整配置 |
| `{home}/.openclaw/groups/workspace-oc_{uid}/memory/health-check-state.json` | 最近健康检查快照 |

### 配置与环境
| 文件 | 说明 |
|------|------|
| `{home}/.openclaw/groups/workspace-oc_{uid}/.env` | CTO 工作区凭据 (ADC EMAIL/PASS) |
| `{home}/.openclaw/cron/jobs.json` | 所有 Agent 的 cron 任务 |
| `{home}/.openclaw/groups/workspace-oc_{uid}/docs/team-members.md` | 团队 UUID / Session Key 映射 |

---

## 八、限制说明

1. **本机无法 SSH 到远程服务器** — exec 安全策略拦截。所有远程操作需通过 itops-agent 的 deploy-agent API。
2. **服务器 git 无 remote 配置** — 本地 commit 无法直接部署。
3. **Cron 刚恢复** — 所有 ADC 任务拉取 cron 已在 08:20 重新启用了 (之前因事故被禁用)。
