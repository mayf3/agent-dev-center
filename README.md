# Agent Dev Center (ADC)

需求驱动的开发管理平台。ADC 让需求从提交到上线的全生命周期可追踪、可管控。

## 项目结构

```
agent-dev-center/
├── backend/          # Express + Prisma + PostgreSQL 后端
├── frontend/         # React + Vite 前端
├── mobile/           # React Native (Expo) 移动端
├── miniprogram/      # 微信小程序
├── docs/             # 设计文档、架构决策
├── scripts/          # 运维脚本
├── e2e/              # Playwright E2E 测试
└── infra/            # 部署配置
```

## 快速开始

```bash
# 后端
cd backend
npm install
cp .env.example .env   # 编辑数据库配置
npx prisma migrate dev
npm run dev

# 前端
cd frontend
npm install
npm run dev
```

## 技术栈

- **后端**: Node.js / Express / TypeScript / Prisma / PostgreSQL
- **前端**: React / Vite / TypeScript
- **移动端**: React Native (Expo)
- **小程序**: 微信原生小程序
- **测试**: Playwright / Vitest

## 核心功能

- 需求生命周期管理（创建 → 审核 → 开发 → 测试 → 上线）
- 角色化工作流（PM / 开发 / QA / 运维 / CTO）
- 自动化评审与质量门禁
- SSO 统一登录
- 看板与报告系统
- Marketplace Agent 管理

## License

MIT
