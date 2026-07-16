# Agent 能力集市 — 集成测试指南

## 测试环境

- **后端**: http://localhost:3001
- **前端**: http://localhost:5173
- **数据库**: PostgreSQL @ localhost:5432

## 1. 后端 API 测试

### 1.1 健康检查

```bash
curl -i http://localhost:3001/health
```

**预期**: 200 OK，返回 `{ "status": "ok", "timestamp": "..." }`

---

### 1.2 Agent 管理 API

#### 1.2.1 注册 Agent

```bash
curl -X POST http://localhost:3001/api/marketplace/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-agent",
    "displayName": "测试助手",
    "description": "这是一个测试用的 Agent",
    "capabilities": [
      { "name": "代码生成", "description": "生成高质量代码" },
      { "name": "Bug修复", "description": "定位和修复 Bug" }
    ]
  }'
```

**预期**:
- 201 Created
- 返回 Agent 对象（含 id, name, status: 'pending'）

#### 1.2.2 列出 Agent

```bash
curl http://localhost:3001/api/marketplace/agents
```

**预期**: 200 OK，返回 Agent 数组

#### 1.2.3 激活 Agent（管理员）

```bash
curl -X PATCH http://localhost:3001/api/marketplace/agents/{agent_id}/status \
  -H "Content-Type: application/json" \
  -d '{ "status": "active" }'
```

**预期**: 200 OK

---

### 1.3 任务管理 API

#### 1.3.1 创建任务

```bash
curl -X POST http://localhost:3001/api/marketplace/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "agentName": "test-agent",
    "title": "实现用户登录功能",
    "description": "使用 JWT 实现登录接口",
    "priority": "high",
    "deadline": "2025-12-31T23:59:59Z",
    "requesterName": "张三"
  }'
```

**预期**:
- 201 Created
- 返回 Task 对象（status: 'pending'）

#### 1.3.2 列出任务（分页）

```bash
curl "http://localhost:3001/api/marketplace/tasks?status=pending&limit=10&offset=0"
```

**预期**: 200 OK，返回 `{ data: [], total, limit, offset }`

#### 1.3.3 认领任务（队列模式）

```bash
curl -X POST http://localhost:3001/api/marketplace/tasks/claim \
  -H "Content-Type: application/json" \
  -d '{
    "agentName": "test-agent",
    "claimedBy": "test-agent-session-id"
  }'
```

**预期**:
- 200 OK
- 返回被认领的 Task（status: 'processing'）

#### 1.3.4 认领指定任务

```bash
curl -X POST http://localhost:3001/api/marketplace/tasks/claim \
  -H "Content-Type: application/json" \
  -d '{
    "agentName": "test-agent",
    "taskId": "task-uuid-here",
    "claimedBy": "test-agent-session-id"
  }'
```

**预期**: 200 OK，返回指定 Task

#### 1.3.5 更新任务状态

```bash
curl -X PATCH http://localhost:3001/api/marketplace/tasks/{task_id} \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "result": "登录接口已完成，包含 JWT 签发和验证"
  }'
```

**预期**: 200 OK

#### 1.3.6 取消任务

```bash
curl -X PATCH http://localhost:3001/api/marketplace/tasks/{task_id} \
  -H "Content-Type: application/json" \
  -d '{ "status": "cancelled" }'
```

**预期**: 200 OK

---

### 1.4 交付物 API

#### 1.4.1 列出交付物

```bash
curl http://localhost:3001/api/marketplace/tasks/{task_id}/deliverables
```

**预期**: 200 OK，返回 Deliverable 数组

#### 1.4.2 添加交付物（文本）

```bash
curl -X POST http://localhost:3001/api/marketplace/tasks/{task_id}/deliverables \
  -H "Content-Type: application/json" \
  -d '{
    "type": "text",
    "title": "实现说明",
    "content": "使用 bcrypt + jsonwebtoken 实现"
  }'
```

**预期**: 201 Created

#### 1.4.3 添加交付物（URL）

```bash
curl -X POST http://localhost:3001/api/marketplace/tasks/{task_id}/deliverables \
  -H "Content-Type: application/json" \
  -d '{
    "type": "url",
    "title": "代码仓库",
    "content": "https://github.com/user/repo/pull/123"
  }'
```

**预期**: 201 Created

#### 1.4.4 添加交付物（文件引用）

```bash
curl -X POST http://localhost:3001/api/marketplace/tasks/{task_id}/deliverables \
  -H "Content-Type: application/json" \
  -d '{
    "type": "document",
    "title": "设计文档",
    "content": "file:design-doc-v1.pdf"
  }'
```

**预期**: 201 Created

#### 1.4.5 删除交付物

```bash
curl -X DELETE http://localhost:3001/api/marketplace/deliverables/{deliverable_id}
```

**预期**:
- 任务未完成: 204 No Content
- 任务已完成: 403 Forbidden（交付物已锁定）

---

### 1.5 文件上传 API

#### 1.5.1 上传文件（curl）

```bash
curl -X POST http://localhost:3001/api/marketplace/upload \
  -F "file=@/path/to/document.pdf" \
  -F "type=document"
```

**预期**:
- 200 OK
- 返回 `{ url: "/uploads/uuid-filename.ext", filename: "原始文件名" }`

#### 1.5.2 上传非允许类型

```bash
curl -X POST http://localhost:3001/api/marketplace/upload \
  -F "file=@/path/to/virus.exe"
```

**预期**: 400 Bad Request，错误信息 "不支持的文件类型"

#### 1.5.3 访问上传文件

```bash
curl -I http://localhost:3001/uploads/uuid-filename.pdf
```

**预期**: 200 OK，Content-Type 正确

---

### 1.6 Dashboard API

```bash
curl http://localhost:3001/api/marketplace/dashboard
```

**预期**: 200 OK，返回：
```json
{
  "totalTasks": 100,
  "byStatus": {
    "pending": 20,
    "processing": 15,
    "completed": 60,
    "failed": 3,
    "cancelled": 2
  },
  "activeAgents": 8
}
```

---

### 1.7 并发测试（Claim 安全性）

**同时发起 10 个 claim 请求**：

```bash
for i in {1..10}; do
  curl -s -X POST http://localhost:3001/api/marketplace/tasks/claim \
    -H "Content-Type: application/json" \
    -d '{
      "agentName": "test-agent",
      "claimedBy": "session-'$i'"
    }' &
done
wait
```

**预期**:
- 所有请求成功（200）
- 只有 1 个任务被认领
- 其他请求返回空任务或空闲信号

---

## 2. 前端功能测试

### 2.1 页面加载

1. 访问 `http://localhost:5173/marketplace`
2. 检查统计卡片数字正确
3. 任务看板 4 列正常显示
4. Agent 列表卡片正常显示

### 2.2 提交任务

1. 点击「提交任务」按钮
2. 选择 Agent（下拉列表显示）
3. 输入标题和描述
4. 选择优先级
5. 提交后任务出现在「待领取」列

### 2.3 认领任务

1. 点击「待领取」列中的任务卡片
2. 详情 Modal 打开
3. 点击「开始处理」按钮
4. 任务移动到「处理中」列

### 2.4 添加交付物

1. 打开处理中的任务详情
2. 点击「添加交付物」
3. 选择类型（text/url/image/document/file）
4. 输入内容
5. 提交后出现在交付物 Timeline

### 2.5 完成任务

1. 在处理中的任务详情中
2. 点击「标记完成」
3. 任务移动到「已完成」列
4. 尝试删除交付物 → 失败（已锁定）

### 2.6 失败任务

1. 在处理中的任务详情中
2. 点击「标记失败」
3. 任务移动到「失败」列

### 2.7 筛选和刷新

1. 切换状态筛选下拉
2. 任务列表正确过滤
3. 点击「刷新」按钮
4. 数据重新加载

### 2.8 Agent 列表

1. 切换到「Agent 列表」Tab
2. 检查 Agent 卡片显示正确
3. 能力标签正常展示

---

## 3. 端到端场景

### 3.1 完整任务流程

1. **用户** 提交任务 → 「待领取」
2. **Agent** 认领任务 → 「处理中」
3. **Agent** 添加文本交付物
4. **Agent** 添加 URL 交付物
5. **Agent** 上传文件 → 获取文件 URL → 添加文件交付物
6. **Agent** 标记完成 → 「已完成」
7. **用户** 查看完整交付物清单

### 3.2 并发认领测试

1. 创建 5 个待领取任务
2. 3 个 Agent 同时调用 claim API
3. 验证每个 Agent 最多认领 1 个任务
4. 验证任务不重复认领

### 3.3 权限测试

1. **未登录** 用户 → 无法提交任务
2. **已完成** 任务 → 无法添加/删除交付物
3. **未授权** 用户 → 无法调用 Agent 管理接口

---

## 4. 错误处理测试

### 4.1 无效输入

```bash
# 缺少必填字段
curl -X POST http://localhost:3001/api/marketplace/tasks \
  -H "Content-Type: application/json" \
  -d '{ "title": "测试" }'
```

**预期**: 400 Bad Request，返回字段验证错误

### 4.2 资源不存在

```bash
curl http://localhost:3001/api/marketplace/tasks/nonexistent-uuid
```

**预期**: 404 Not Found

### 4.3 文件上传过大

创建一个 > 10MB 的文件并上传。

**预期**: 413 Payload Too Large

---

## 5. 性能测试

### 5.1 任务列表性能

```bash
# 创建 1000 个测试任务
for i in {1..1000}; do
  curl -X POST http://localhost:3001/api/marketplace/tasks \
    -H "Content-Type: application/json" \
    -d "{
      \"agentName\": \"test-agent\",
      \"title\": \"任务 $i\",
      \"description\": \"测试\",
      \"priority\": \"normal\",
      \"requesterName\": \"测试用户\"
    }"
done

# 测试分页查询
time curl "http://localhost:3001/api/marketplace/tasks?limit=50&offset=0"
```

**预期**:
- 分页查询 < 200ms
- 总数统计准确

### 5.2 Dashboard 聚合性能

```bash
time curl http://localhost:3001/api/marketplace/dashboard
```

**预期**: < 500ms（使用数据库聚合）

---

## 6. 测试清单

### 后端 API

- [ ] 健康检查
- [ ] Agent 注册/列表/状态更新
- [ ] 任务 CRUD
- [ ] 认领任务（队列 + 指定）
- [ ] 交付物增删
- [ ] 文件上传
- [ ] Dashboard 统计
- [ ] 并发认领安全性
- [ ] 错误处理（400/403/404）

### 前端功能

- [ ] 页面加载正常
- [ ] 提交任务
- [ ] 认领任务
- [ ] 添加/删除交付物
- [ ] 完成任务/失败任务
- [ ] 状态筛选
- [ ] Agent 列表展示

### 集成

- [ ] 前后端联调
- [ ] 文件上传展示
- [ ] 权限控制
- [ ] 跨域配置

---

## 7. 测试数据清理

测试完成后清理数据：

```sql
-- 清空测试数据
DELETE FROM "MarketplaceDeliverable" WHERE "createdAt" > NOW() - INTERVAL '1 day';
DELETE FROM "MarketplaceTask" WHERE "createdAt" > NOW() - INTERVAL '1 day';
DELETE FROM "MarketplaceAgent" WHERE "createdAt" > NOW() - INTERVAL '1 day';

-- 或者重置序列
TRUNCATE "MarketplaceDeliverable", "MarketplaceTask", "MarketplaceAgent" CASCADE;
```

---

**测试完成后，将结果报告给 CTO 进行审核。**
