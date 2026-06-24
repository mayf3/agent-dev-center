# 验尸报告：ADC 平台今日反复 502 崩溃（2026-05-24）

**日期**：2026-05-24
**严重程度**：P1（平台一天内多次不可用）
**影响**：ADC 平台从下午多次 502，累计不可用约 1-2 小时

## 现象

ADC 平台今天多次出现 502 Bad Gateway。每次都是后端容器 crash loop 重启。

## 崩溃时间线

| 时间 | 触发 | 错误 | 恢复方式 |
|------|------|------|---------|
| ~14:00 | CTO 部署 SSO 修复代码 | gatewayGuard IP 白名单拒绝 Docker 网桥 IP | 修改 ip-whitelist.ts + docker cp |
| ~17:00 | CTO 执行 `docker compose up -d backend` | Prisma P3019 migration_lock.toml 冲突 + P1000 密码认证失败 | ALTER USER + rebuild |
| 17:57 | 自动恢复 | devtools-agent 的重构 commit 清理了迁移文件 | docker compose build + up |

## 根因分析（问 5 个为什么）

### 崩溃 1：gatewayGuard IP 白名单
1. 为什么 502？→ 后端容器 crash loop
2. 为什么 crash？→ gatewayGuard 中间件拦截所有 API 请求返回 403
3. 为什么拦截？→ 只放行 `127.0.0.1`，但 Docker 网桥请求来自 `172.22.0.1`
4. 为什么写死 `127.0.0.1`？→ 开发时在本地测试，没考虑 Docker 网桥网络
5. 为什么没有 CI 测试拦截？→ 没有 CI/CD，代码直接 scp 到生产环境

**根因**：没有 CI 测试 + 没有 Docker 网络环境测试 + 硬编码 IP

### 崩溃 2：Postgres 密码 + Migration 冲突
1. 为什么 502？→ 后端 crash loop
2. 为什么 crash？→ Prisma 报错 P1000（密码认证失败）+ P3019（migration_lock 冲突）
3. 为什么密码认证失败？→ `docker compose up -d backend` 触发了 postgres 容器重建，重建时 postgres 重新读取 .env 的密码，但 volume 中已有数据使用的是旧密码
4. 为什么会重建 postgres？→ `docker compose up` 检测到 compose 文件有变化时自动重建所有相关容器
5. 为什么密码会不一致？→ 没有密码管理机制，之前手动 ALTER USER 改过密码，但 .env 没同步

**根因**：没有密码管理机制 + docker compose 随意 up 导致容器重建 + 密码散落在多个地方

### 崩溃 3：Migration lock 冲突
1. 为什么 P3019？→ Prisma 检测到 migration_lock.toml 中的 provider 与某个子目录的不匹配
2. 为什么有不匹配？→ agent-dev-engineer 在推送迁移时可能生成了嵌套的 migration_lock.toml
3. 为什么没有在开发环境发现？→ 没有本地 Docker 环境验证，代码直接推到生产

**根因**：没有本地集成测试 + 没有 CI/CD 质量门禁

## 共同根因（系统性问题）

**ADC 平台今天 3 次崩溃的共同根因是：没有 CI/CD，代码直接手动 scp 到生产环境。**

具体表现：
1. 代码变更没有经过自动化测试验证
2. 部署过程依赖手动操作（scp + docker cp + docker compose up）
3. 没有回滚机制（坏了只能手动修）
4. 没有密码/配置管理（密码散落在 .env、ALTER USER、docker cp 里）

## 长期原则

### 原则 1：docker compose up 是危险操作
- `docker compose up -d` 可能重建容器（如果 compose 文件变了）
- 容器重建 = 环境变量重新读取 = 可能与持久化数据冲突
- **安全操作**：只更新代码时用 `docker cp` + `docker restart`，不用 `docker compose up`

### 原则 2：Postgres 密码不可变
- Postgres 密码在第一次 `docker compose up`（创建 volume）时写入
- 之后密码固化在 volume 中，改 .env 不会影响已有数据
- **如果要改密码**：必须 ALTER USER + 更新 .env 同时操作
- **最佳实践**：密码从第一次部署后永不更改

### 原则 3：部署必须有回滚能力
- 每次部署前必须能快速回滚到上一个版本
- 当前方案：git push + 手动 docker compose = 没有回滚
- 目标方案：git tag + CI/CD 自动构建 + 出问题回退 tag

### 原则 4：Prisma 迁移必须在本地验证
- 迁移文件推到生产前必须本地 `prisma migrate deploy` 验证
- 不能直接在生产环境跑未验证的迁移

## 预防措施

| 措施 | 类型 | 优先级 |
|------|------|--------|
| deploy.sh 增加容器重建保护（检测是否需要重建 postgres） | 自动化 | P1 |
| 密码锁定机制：首次初始化后锁死，后续 .env 只读 | 配置 | P1 |
| CI/CD 流水线（build + test + deploy） | 基础设施 | P0 |
| Prisma 迁移 pre-check 脚本 | 自动化 | P2 |
| 部署健康检查：deploy 后自动 curl /api/health | 自动化 | P1（已有 deploy.sh） |

## 落盘
- [x] 本文件：`docs/postmortem-adc-repeated-502-20260524.md`
- [x] 上传 ADC：POSTMORTEM 报告
- [x] 更新 `docs/postmortem-lessons.md`
- [x] 更新 deploy.sh 增加容器重建保护
