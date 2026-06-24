# Agent开发中心 - MVP需求文档

## 项目概述
一个需求驱动的开发管理平台，实现从需求收集到开发交付的全流程闭环。

## MVP功能范围

### 1. 需求管理系统

#### 1.1 需求提交
- 提需求表单：标题、描述（Markdown）、优先级(P0-P3)、期望交付时间、业务线、附件
- API提交接口（供其他Agent调用）
- 需求列表（支持筛选/搜索/分页）

#### 1.2 需求审核
- 审核面板（需求详情、状态管理）
- 状态：待审核 → 审核通过/拒绝 → 开发中 → 测试中 → 待验收 → 已完成
- 拒绝时可填写拒绝原因

#### 1.3 任务分配
- 需求通过后自动/手动分配给开发Agent
- 可选分配对象：game-dev-agent, mobile-app-engineer, miniapp-game-engineer, backend-engineer, frontend-engineer

### 2. 看板视图
- 四个列：待开发 | 开发中 | 测试中 | 已完成
- 拖拽修改状态
- 卡片显示：需求标题、优先级、负责人、截止时间

### 3. 用户与权限
- CTO（管理员）：全部权限
- 需求提交者：提需求、查看进度
- 开发Agent：查看分配的任务，更新状态

### 4. 通知集成
- 飞书群通知（需求提交、状态变更）
- Agent API回调通知

## 技术栈

### 后端
- Node.js + TypeScript
- Express/Fastify
- PostgreSQL (with Prisma ORM)
- Redis (缓存)
- JWT认证

### 前端
- React 18 + TypeScript
- Vite构建
- Ant Design组件库
- React Router v6

### 移动端（第二阶段）
- React Native

### 小程序（第二阶段）
- 微信小程序原生

## 数据模型

### 需求 (Requirement)
- id: UUID
- title: string
- description: text (Markdown)
- priority: enum(P0/P1/P2/P3)
- status: enum(pending/approved/rejected/in-progress/testing/review/done)
- requester: string (提交者名称)
- department: string (业务线)
- assignee: string (负责人，可选)
- dueDate: datetime
- attachment: string (附件URL)
- rejectReason: text
- createdAt: datetime
- updatedAt: datetime

### 任务 (Task)
- id: UUID
- requirementId: UUID (关联需求)
- title: string
- description: text
- agentType: string (分配给哪个Agent)
- status: enum(todo/in-progress/done)
- createdAt: datetime
- updatedAt: datetime

### 用户 (User)
- id: UUID
- name: string
- email: string
- role: enum(admin/requester/developer)
- password: (hashed)
- createdAt: datetime

## API设计

### 需求接口
- POST /api/requirements - 提交需求
- GET /api/requirements - 获取需求列表（分页/筛选）
- GET /api/requirements/:id - 获取需求详情
- PATCH /api/requirements/:id - 更新需求状态
- PUT /api/requirements/:id - 编辑需求

### 任务接口
- POST /api/tasks - 创建任务
- GET /api/tasks - 获取任务列表
- PATCH /api/tasks/:id - 更新任务状态

### 认证接口
- POST /api/auth/login - 登录
- POST /api/auth/register - 注册

## 部署
- Docker容器化
- GitHub仓库
- 云服务器

## 第一阶段验收标准
1. ✅ 用户可提交需求、管理需求
2. ✅ CTO可审核、分配任务
3. ✅ 看板视图可用
4. ✅ 飞书通知集成
5. ✅ 基本权限管理
6. ✅ Docker部署
