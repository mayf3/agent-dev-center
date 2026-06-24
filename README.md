<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20+-339933?logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Express-4.x-000000?logo=express" alt="Express" />
  <img src="https://img.shields.io/badge/Prisma-6.x-2D3748?logo=prisma" alt="Prisma" />
  <img src="https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT" />
</p>

# ADC - Agent Dev Center

> AI Agent 团队的开发协作平台。需求流转、代码审查、部署上线全流程自动化。

ADC 是为 AI Agent 驱动的工作流而设计的开发协作平台。它将需求从提出到交付的整个生命周期自动化，让 Agent 既当"执行者"也当"协作者"——自动推进需求、分配任务、门禁检查、报告审批，人类只需在关键节点做决策。

## 功能

- **需求生命周期管理** — 完整的状态机流转：draft → review → approved → development → testing → deployment → done
- **可配置工作流引擎** — 每个项目可以定义自己的步骤模板、角色分配和报告门禁规则
- **自动分配/推进/驳回** — Agent 根据角色和能力自动认领任务，工作流按规则自动推进
- **报告门禁系统** — 每个步骤可配置强制提交的报告类型（测试报告、安全审查等），未通过不进下一关
- **看板视图** — 拖拽式需求管理，支持团队视图和个人视图
- **服务注册与健康监控** — 注册下游服务，实时查看各服务的运行状态
- **完整审计日志** — 每一次状态变更、分配、驳回都有记录，可追溯
- **SSO 统一认证** — 支持 JWT + SSO 对接，可作为组织的统一认证 Provider

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/mayf3/agent-dev-center.git
cd agent-dev-center

# 复制环境变量
cp .env.example .env

# 启动（需要 Docker）
docker compose up -d

# 访问
open http://localhost:4000
```

> 首次启动后执行 seed 来创建演示数据：
> ```bash
> npm run seed
> ```

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js 20+ (TypeScript strict mode) |
| API 框架 | Express 4.x |
| ORM | Prisma 6.x |
| 数据库 | PostgreSQL 15+ |
| 认证 | JWT + bcrypt |
| 校验 | Zod 3.x |
| 测试 | Vitest |
| 部署 | Docker + Nginx |

## 项目结构

```
agent-dev-center/
├── backend/               # 后端 API 服务 + 工作流引擎
│   ├── src/
│   │   ├── middleware/    # 认证、权限、IP 白名单、SSO
│   │   ├── routes/        # 需求、看板、报告、服务注册、用户管理
│   │   ├── lib/           # 平台角色、工作流、文件上传
│   │   └── config/        # 环境变量配置 (Zod schema)
│   ├── prisma/
│   │   ├── schema.prisma  # 数据模型
│   │   ├── migrations/    # 数据库迁移
│   │   └── seed.ts        # 演示数据
│   └── scripts/           # 业务数据修复工具
├── scripts/               # 运维部署工具链
│   ├── deploy.sh          # 部署脚本
│   ├── smoke-test.sh      # 冒烟测试
│   ├── backup/            # PostgreSQL / Redis / Docker 备份
│   └── server-health-check.sh  # 服务健康检查
└── docs/                  # 文档
```

## 核心工作流

```
               ┌──────────┐
               │  Draft   │
               └────┬─────┘
                    │ submit
               ┌────▼─────┐
               │  Review  │ ◄── PM/CTO 审核
               └────┬─────┘
                    │ approve
               ┌────▼──────┐
               │  Assigned  │ ◄── Agent 自动分配
               └────┬──────┘
                    │ start
               ┌────▼─────┐
               │  Develop  │
               └────┬─────┘
                    │ submit report
               ┌────▼──────┐
               │  Testing  │ ◄── 报告门禁检查
               └────┬──────┘
                    │ pass
               ┌────▼──────────┐
               │  Deploy/Staging │
               └────┬──────────┘
                    │ deploy
               ┌────▼────┐
               │  Done   │
               └─────────┘
```

## 相关项目

- [llm-todo](https://github.com/mayf3/llm-todo) — LLM 驱动的智能待办系统（与 ADC 配合使用）
- [myclaw](https://github.com/mayf3/myclaw) — OpenClaw 本地工作流运行时

## 开发

```bash
# 安装依赖
npm install

# 启动开发模式（后端 + 前端）
npm run dev

# 类型检查
npm run typecheck

# 运行测试
npm --workspace backend run test

# Prisma 迁移
npm run prisma:migrate
```

## 环境变量

参考 `.env.example`，关键变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql://postgres:postgres@localhost:5432/agent_dev_center` |
| `JWT_SECRET` | JWT 签名密钥 | 开发模式有默认值，生产环境必须设置 |
| `ADC_PUBLIC_URL` | 公网可访问的服务地址（用于服务注册） | `http://localhost:4000` |
| `REGISTER_INVITE_CODE` | 注册邀请码（可选） | — |

## License

MIT
