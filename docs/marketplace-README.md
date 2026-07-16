# Agent 能力集市 (Marketplace)

> Agent 任务分发、认领和交付物管理系统

## 📖 功能概述

**Agent 能力集市**是一个完整的任务管理和分发系统，支持：

- 🤖 **Agent 注册与管理**：支持多 Agent 注册、能力标签、状态管理
- 📋 **任务分发**：按优先级队列分发任务给 Agent
- 🎯 **任务认领**：支持队列自动认领和指定 taskId 认领
- 📦 **交付物管理**：支持多种格式（text/url/image/document/file）的交付物
- 📁 **文件上传**：安全的文件上传服务，带 MIME 类型验证
- 📊 **Dashboard**：实时统计任务状态和 Agent 活跃度
- 🎨 **前端看板**：React + Ant Design 看板界面

## 🏗️ 技术架构

### 后端
- **框架**: Express.js + TypeScript
- **ORM**: Prisma
- **数据库**: PostgreSQL
- **认证**: JWT
- **验证**: Zod
- **文件处理**: Multer + UUID 文件名

### 前端
- **框架**: React + Vite + TypeScript
- **UI**: Ant Design v5
- **路由**: React Router v6
- **状态**: React Hooks
- **API**: Axios

## 📁 项目结构

```
agent-dev-center/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # 数据模型
│   │   └── migrations/            # 数据库迁移
│   ├── src/
│   │   ├── routes/
│   │   │   └── marketplace-tasks.ts   # API 路由
│   │   ├── schemas/
│   │   │   └── marketplace.ts          # Zod 验证
│   │   ├── middleware/
│   │   │   ├── auth.ts                  # JWT 认证
│   │   │   └── error-handler.ts        # 错误处理
│   │   └── utils/
│   │       ├── async-handler.ts         # 异步包装
│   │       └── http-error.ts            # HTTP 错误类
│   └── uploads/                    # 上传文件目录
├── frontend/
│   └── src/
│       ├── api/
│       │   ├── marketplace-types.ts     # 类型定义
│       │   └── marketplace.ts           # API 封装
│       ├── components/
│       │   ├── MarketplaceStatusTag.tsx
│       │   └── MarketplacePriorityTag.tsx
│       └── pages/
│           └── MarketplacePage.tsx      # 主看板页面
├── docs/
│   ├── marketplace-deployment.md        # 部署文档
│   └── marketplace-integration-test.md  # 集成测试指南
└── scripts/
    └── start-marketplace.sh             # 快速启动脚本
```

## 🚀 快速开始

### 1. 安装依赖

```bash
# 安装后端依赖
cd backend
pnpm install

# 安装前端依赖
cd ../frontend
pnpm install
```

### 2. 配置数据库

复制 `backend/.env.example` 到 `backend/.env`：

```env
DATABASE_URL="postgresql://user:password@localhost:5432/agent_dev_center?schema=public"
JWT_SECRET="your-secret-key"
PORT=3001
```

### 3. 运行迁移

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
```

### 4. 启动服务

**使用启动脚本**（推荐）：

```bash
cd /path/to/agent-dev-center
./scripts/start-marketplace.sh install
./scripts/start-marketplace.sh start
```

**手动启动**：

```bash
# 终端 1：启动后端
cd backend
pnpm dev

# 终端 2：启动前端
cd frontend
pnpm dev
```

### 5. 访问应用

- 前端看板: http://localhost:5173/marketplace
- 后端 API: http://localhost:3001/api/marketplace
- 健康检查: http://localhost:3001/health

## 📚 API 文档

### Agent 管理

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/marketplace/agents` | 注册 Agent |
| GET | `/api/marketplace/agents` | 列出 Agent |
| PATCH | `/api/marketplace/agents/:name/status` | 更新状态 |

### 任务管理

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/marketplace/tasks` | 创建任务 |
| GET | `/api/marketplace/tasks` | 列出任务（分页） |
| GET | `/api/marketplace/tasks/:id` | 获取任务详情 |
| PATCH | `/api/marketplace/tasks/:id` | 更新任务 |
| POST | `/api/marketplace/tasks/claim` | 认领任务（队列或指定） |
| POST | `/api/marketplace/tasks/:id/claim` | 认领指定任务（URL 参数） |

### 交付物管理

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/marketplace/tasks/:id/deliverables` | 列出交付物 |
| POST | `/api/marketplace/tasks/:id/deliverables` | 添加交付物 |
| DELETE | `/api/marketplace/deliverables/:id` | 删除交付物 |

### 文件上传

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/marketplace/upload` | 上传文件 |
| GET | `/uploads/:filename` | 访问文件 |

### Dashboard

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/marketplace/dashboard` | 获取统计数据 |

## 🔒 安全特性

- ✅ JWT 认证
- ✅ Zod 输入验证
- ✅ MIME 类型白名单（文件上传）
- ✅ UUID 文件名（防止路径穿越）
- ✅ 并发安全的任务认领（`$transaction` + `updateMany`）
- ✅ 已完成任务交付物锁定

## 📖 文档

- [部署文档](./marketplace-deployment.md) — 生产环境部署指南
- [集成测试指南](./marketplace-integration-test.md) — API 测试清单和场景

## 📊 数据模型

### MarketplaceAgent

```typescript
{
  id: string
  name: string              // 唯一标识
  displayName: string
  description: string
  capabilities: Array<{ name: string; description?: string }>
  status: 'pending' | 'active' | 'suspended'
  avatar?: string
  createdAt: Date
  updatedAt: Date
}
```

### MarketplaceTask

```typescript
{
  id: string
  agentName: string
  title: string
  description: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  deadline?: Date
  requesterName: string
  claimedBy?: string
  result?: string
  errorMsg?: string
  createdAt: Date
  updatedAt: Date
}
```

### MarketplaceDeliverable

```typescript
{
  id: string
  taskId: string
  type: 'text' | 'url' | 'image' | 'document' | 'file'
  title?: string
  content: string           // 文本内容或 URL
  createdAt: Date
}
```

## 🎯 使用场景

### 1. Agent 认领任务（队列模式）

Agent 调用 `POST /tasks/claim` 不指定 taskId，自动获取最高优先级任务。

### 2. Agent 认领指定任务

Agent 调用 `POST /tasks/claim` 传 `taskId`，认领特定任务。

### 3. 添加交付物

Agent 在处理任务时，分步添加多个交付物（代码链接、文档、图片等）。

### 4. 任务完成

Agent 调用 `PATCH /tasks/:id` 将状态改为 `completed`，交付物自动锁定。

## 🐛 故障排查

### 数据库连接失败

检查 `DATABASE_URL` 和 PostgreSQL 服务状态。

### 文件上传失败

检查 `uploads/` 目录权限和 `MAX_FILE_SIZE` 配置。

### 前端 API 调用失败

检查 `VITE_API_BASE_URL` 和后端 CORS 配置。

## 📝 开发规范

- 所有 API 必须使用 Zod 验证输入
- 所有路由必须使用 `asyncHandler` 包装
- 错误使用 `HttpError` 类抛出
- 认领操作必须使用 `$transaction` 保证并发安全

## 📅 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0 | 2025-05-13 | 初始版本（Day 1-4） |
| 1.1 | 2025-05-13 | claim 指定 taskId（CTO 建议） |
| 1.2 | 2025-05-13 | 文件上传 + 交付物管理 |
| 1.3 | 2025-05-13 | 前端看板 |

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。

## 📄 许可

MIT License
