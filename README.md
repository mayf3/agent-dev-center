# Agent Dev Center

Agent 开发中心 — 基于需求驱动开发（Demand-Driven Development）的 Agent 全生命周期管理平台。

## 功能

- 需求管理（Requirement 创建、流转、闭环）
- Agent 开发工作流
- 服务注册与发现
- 自动化发布管理
- Marketplace 集成
- Agent SSO 认证

## 技术栈

- **后端**: Node.js + Prisma ORM + PostgreSQL
- **前端**: Vite + React
- **认证**: JWT + SSO
- **部署**: Docker Compose

## 快速开始

```bash
# 1. 复制环境变量模板
cp .env.example .env

# 2. 启动数据库
docker compose up -d postgres

# 3. 初始化数据库
npx prisma migrate deploy

# 4. 启动后端
npm run dev

# 5. 启动前端
cd frontend && npm run dev
```

## License

MIT
