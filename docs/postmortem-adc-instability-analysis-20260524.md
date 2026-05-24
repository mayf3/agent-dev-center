## ADC 平台不稳态系统分析报告

### 概述
ADC 需求平台自 2026-05-16 上线以来，两周内发生 5 次生产事故，平均每 2.8 天一次。本报告系统性分析根因和解决方案。

### 事故清单

| # | 日期 | 现象 | 根因 | 类型 | 影响时长 |
|---|------|------|------|------|---------|
| 1 | 5/19-20 | SSO 认证失败 | JWT 多密钥不统一（项目之间 `JWT_SECRET` vs `SSO_JWT_SECRET` 不一致） | 架构**设计缺陷** | 多小时 |
| 2 | 5/20 | 服务 502 | Node.js 绑定 `127.0.0.1`，Docker 容器内无法被宿主机访问 | **Docker 环境差异** | 小时级 |
| 3 | 5/20 | Article Review 根路径 404 | Nginx 代理前缀与容器内路由不匹配 | **部署验证缺失** | 小时级 |
| 4 | 5/20 | 个人属性平台部署缺验证 | DEV_SELF_CHECK 未包含生产环境 curl 验证 | **部署验证缺失** | 小时级 |
| 5 | **5/24** | **所有 API 403** | gatewayGuard 中间件只放行 `127.0.0.1`，Docker 容器内源 IP 是网桥网关 | **Docker 环境差异** | 约 1 小时 |

### 根因分析（问 5 个为什么）

**为什么 1：** 为什么两周出 5 次问题？因为每次部署都是"人工操作"，没有自动化验证环节。

**为什么 2：** 为什么没有自动化验证？因为没有 CI/CD pipeline——没有 lint, typecheck, test, build, deploy, healthcheck 的自动化闭环。

**为什么 3：** 为什么没有 CI/CD？因为之前认为"人少项目小，手动部署就够了"。

**为什么 4：** 为什么"手动部署就够了"这个假设会出问题？因为在 Docker + Nginx 的生产环境下，**开发环境和生产环境存在系统性差异**：
- Docker 网络模式（bridge vs host）
- 端口映射带来的 IP 变化
- Nginx 代理前缀与实际路由的对齐
- 中间件在生产模式下的行为差异

**为什么 5：** 这些差异为什么不在开发时被发现？因为没有 "生产环境等价" 的测试环境，DEV_SELF_CHECK 只测了本地 localhost，没有通过 Nginx 代理完整链路验证。

### 本质结论
ADC 平台不稳定的根本原因不是**代码质量**（每次都是连接/配置问题，不是功能 bug），而是**部署流程质量**——缺乏从代码提交到生产验证的自动化 pipeline。5 次事故中有 4 次可以通过「部署后自动 curl 验证全部端点」提前发现。

### 解决方案

#### 短期（已完成）
1. ✅ `scripts/deploy.sh` — 本地部署流水线：typecheck → test → build → git push → 健康检查
2. ✅ git post-receive hook — 服务器自动构建和部署
3. ✅ `scripts/server-health-check.sh` — 5 项端点全自动验证（首页 / API健康 / 登录 / 需求列表 / Docker状态）
4. ✅ 服务器每 10 分钟 cron 健康检查 + 自动恢复（宕机自动重启容器）

#### 中期（待做）
5. 🔲 修复 `backend/src/routes/requirements.ts` TypeScript 编译错误（`requirements/` 子目录的拆分重构）
6. 🔲 服务器监控告警到群聊（健康检查失败时自动通知到飞书）
7. 🔲 docker-compose.yml HEALTHCHECK 针对所有服务

#### 长期（待规划）
8. 🔲 GitHub Actions 替代本地手动部署
9. 🔲 负载测试和压力测试
10. 🔲 蓝绿部署 / 滚动更新

### 部署流程（更新后）

```
本地开发 → git commit → git push server main
                                       ↓
                              server post-receive hook
                                       ↓
                              git pull → docker compose build
                                       ↓
                              docker compose up -d
                                       ↓
                              wait 8s → health check (5项)
                                       ↓
                            ✅ 成功 or ❌ 失败告警
```
