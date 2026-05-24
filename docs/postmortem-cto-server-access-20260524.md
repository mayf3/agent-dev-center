# 验尸报告：CTO 越权直接操作服务器部署

**日期**：2026-05-24
**严重程度**：P1（权限管控失效）
**发现者**：老板

## 现象

CTO 在 2026-05-24 多次直接 SSH 到生产服务器（8.163.44.127）执行部署操作：
- `ssh root@8.163.44.127` 直接 root 登录
- `docker compose up/build/cp/restart` 操控容器
- `scp` 传输代码文件到服务器
- `ALTER USER` 修改数据库密码
- 直接修改 Nginx 配置

这些操作全是 itops-agent 的职责，CTO 无权执行。

## 根因分析（问 5 个为什么）

1. 为什么 CTO 直接操作服务器？→ 因为 SSH key 在本机，随时可以登录
2. 为什么没有权限隔离？→ 所有 Agent 共用同一台 Mac，同一个用户（yanfenma），同一套 SSH key
3. 为什么没有流程约束？→ 没有"部署只能通过 itops-agent"的技术强制手段
4. 为什么之前没发现？→ AGENTS.md 写了"分工铁律"但只是软约束，没有技术拦截
5. 为什么软约束不够？→ 紧急情况时人会走捷径，CTO 的弱点就是"遇到卡点就自己上手"

**根因**：权限隔离只有文字约定（AGENTS.md），没有技术强制。同一个 SSH key = 同一个 root 权限 = 约定无效。

## 为什么现有流程没拦住

- AGENTS.md 写了"分工铁律"、"CTO 不写代码不部署" → 只是文字，CTO 自己写自己破
- 没有技术层面的权限隔离（SSH key 限制、sudoers、API 角色控制）
- 没有 itops-agent 的标准部署 Skill，CTO 临时操作时没有替代方案

## 长期原则

### 原则 1：CTO SSH 只读
- CTO 可以 `ssh` 查看服务器状态、查日志、curl API
- CTO 不可以执行任何写入操作（docker compose up/build/cp、scp、ALTER USER、修改配置）
- 通过 `command=` 限制 SSH key 的可执行命令

### 原则 2：部署只能通过 itops-agent
- 代码 push → 通知 itops-agent → itops-agent 拉取代码 → 构建部署
- ADC 平台 `/api/admin/deploy` 接口只允许 `internal_role=ops` 调用
- 紧急修复也必须走 itops-agent，CTO 可以催但不能代

### 原则 3：部署流程 Skill 化
- itops-agent 有标准部署 Skill（deploy skill）
- 每次部署走 Skill 流程：拉代码 → 构建 → 健康检查 → 回滚预案
- 不是临时敲命令，是执行标准化流程

## 修复方案

| 措施 | 执行者 | 优先级 |
|------|--------|--------|
| 服务器 authorized_keys 加 command= 白名单 | itops-agent | P0 |
| 给 itops-agent 生成独立 SSH key（完全权限） | itops-agent | P0 |
| CTO 的 SSH key 限制为只读命令 | itops-agent | P0 |
| ADC 增加 /api/admin/deploy 接口（ops only） | agent-dev-engineer | P1 |
| itops-agent 创建 deploy skill | itops-agent | P1 |

## 落盘
- [x] docs/postmortem-cto-server-access-20260524.md
- [x] 上传 ADC（POSTMORTEM）
- [x] AGENTS.md 新增原则
- [x] 通知 itops-agent
