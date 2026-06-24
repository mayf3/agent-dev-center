# 服务注册中心 — 集成测试文档

## 1. 后端 API 测试

### 1.1 服务注册 CRUD

#### 创建服务 — POST /api/services
```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"{your-test-password}"}' | jq -r '.accessToken')

# 注册新服务
curl -s -X POST http://localhost:4000/api/services \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-service",
    "displayName": "测试服务",
    "description": "用于集成测试的临时服务",
    "port": 8080,
    "localUrl": "http://localhost:8080",
    "remoteUrl": "http://example.com",
    "techStack": ["Node.js", "Express"],
    "owner": "test-agent",
    "gitRepo": "/tmp/test-repo",
    "database": "SQLite"
  }'
```

**期望结果**: `201 Created`，返回带 `id` 的服务对象

#### 获取服务列表 — GET /api/services
```bash
curl -s http://localhost:4000/api/services \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**期望结果**: `200 OK`，`data` 数组 + `pagination` 对象

#### 筛选测试
```bash
# 按状态筛选
curl -s "http://localhost:4000/api/services?status=online" \
  -H "Authorization: Bearer $TOKEN"

# 按负责人筛选
curl -s "http://localhost:4000/api/services?owner=agent-dev-engineer" \
  -H "Authorization: Bearer $TOKEN"
```

#### 获取服务详情 — GET /api/services/:id
```bash
SERVICE_ID="<从创建结果获取>"
curl -s "http://localhost:4000/api/services/$SERVICE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**期望结果**: `200 OK`，包含 `requirements` 关联数组

#### 更新服务 — PATCH /api/services/:id
```bash
curl -s -X PATCH "http://localhost:4000/api/services/$SERVICE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "maintenance", "version": "2.0.0"}'
```

**期望结果**: `200 OK`，status 变为 `maintenance`，version 变为 `2.0.0`

#### 重复名称检测
```bash
curl -s -X POST http://localhost:4000/api/services \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-service",
    "displayName": "重复服务",
    "description": "应该失败"
  }'
```

**期望结果**: `409 Conflict`

### 1.2 Git 提交记录 — GET /api/services/:id/commits

```bash
# 获取有 gitRepo 的服务 ID
curl -s "http://localhost:4000/api/services/$SERVICE_ID/commits?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**期望结果**: `200 OK`，返回 commit 数组（hash, shortHash, author, date, message）

**无 gitRepo 的服务**: 返回空数组 + message

### 1.3 关联需求 — GET /api/services/:id/requirements

```bash
curl -s "http://localhost:4000/api/services/$SERVICE_ID/requirements" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**期望结果**: `200 OK`，返回 `data` + `grouped`（按 status 分组）

### 1.4 健康检查（保留）

```bash
# GET /api/services/status
curl -s http://localhost:4000/api/services/status \
  -H "Authorization: Bearer $TOKEN" | jq '.summary'

# POST /api/services/refresh
curl -s -X POST http://localhost:4000/api/services/refresh \
  -H "Authorization: Bearer $TOKEN" | jq '.summary'
```

### 1.5 边界条件

| 测试 | 方法 | 期望 |
|------|------|------|
| 无效 UUID | `GET /api/services/not-a-uuid` | `400 Bad Request` |
| 不存在的服务 | `GET /api/services/00000000-0000-0000-0000-000000000000` | `404 Not Found` |
| 空请求体 | `POST /api/services {}` | `400 Bad Request` |
| 未认证 | `GET /api/services`（无 header） | `401 Unauthorized` |
| name 太短 | `POST /api/services {"name":"a"}` | `400 Bad Request` |

### 1.6 种子数据验证

```bash
npm run seed:services
# 然后查询
curl -s "http://localhost:4000/api/services?limit=50" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'
```

**期望**: 5 个服务

## 2. 前端功能测试

### 2.1 服务列表页

| # | 操作 | 期望 |
|---|------|------|
| 1 | 访问 /services | 显示"服务注册中心"标题 + 双 Tab |
| 2 | 查看"注册中心" Tab | 卡片列表，每张卡片含状态灯、技术栈、负责人 |
| 3 | 切换到"健康监控" Tab | 显示本地/远程服务健康状态 |
| 4 | 点击"立即刷新" | 加载动画 → 数据更新 |
| 5 | 查看统计卡片 | 显示正确的已注册/在线/离线数字 |

### 2.2 服务详情页

| # | 操作 | 期望 |
|---|------|------|
| 1 | 点击服务卡片 | 跳转到 /services/:id |
| 2 | 查看"概览" Tab | Descriptions 展示完整 meta 信息 |
| 3 | 点击"开发记录" Tab | 懒加载 git commit timeline |
| 4 | 点击"部署历史" Tab | 显示"功能开发中"占位符 |
| 5 | 点击"关联需求" Tab | 按状态分组的需求表格 |
| 6 | 点击"返回"按钮 | 回到 /services 列表 |
| 7 | 快速操作 → 打开本地/远程 | 新标签页打开链接 |

### 2.3 响应式

| # | 场景 | 期望 |
|---|------|------|
| 1 | 窄屏 (< 768px) | 卡片单列，标题缩小 |
| 2 | 宽屏 (>= 1200px) | 卡片 4 列网格 |

## 3. E2E 测试场景

### 场景 1：注册 → 查看 → 更新 → 验证

1. POST 注册新服务 → 201
2. GET 详情 → 验证所有字段
3. PATCH 更新状态为 online → 200
4. GET 列表筛选 status=online → 包含新服务

### 场景 2：Git 提交记录

1. GET 已注册服务的 commits → 返回 commit 列表
2. 验证 commit 包含 hash/author/date/message 字段
3. 前端详情页"开发记录" Tab 正确渲染 Timeline

### 场景 3：关联需求

1. GET 服务关联需求
2. 验证 grouped 结构按 status 分组
3. 前端详情页"关联需求" Tab 正确渲染

## 4. 性能基准

| API | 目标响应时间 |
|-----|-------------|
| GET /api/services | < 100ms |
| GET /api/services/:id | < 50ms |
| POST /api/services | < 100ms |
| PATCH /api/services/:id | < 50ms |
| GET /api/services/:id/commits | < 2s (系统 git) |
| GET /api/services/:id/requirements | < 100ms |
| GET /api/services/status | < 5s (网络探测) |

## 5. 测试清单

- [ ] 创建服务（正常）
- [ ] 创建服务（重复名称 409）
- [ ] 获取服务列表
- [ ] 按状态筛选
- [ ] 按负责人筛选
- [ ] 分页查询
- [ ] 获取服务详情（含 requirements 关联）
- [ ] 更新服务信息
- [ ] 获取 Git 提交记录
- [ ] 获取关联需求（分组）
- [ ] 健康检查 /status
- [ ] 强制刷新 /refresh
- [ ] 无效 UUID → 400
- [ ] 不存在 ID → 404
- [ ] 未认证 → 401
- [ ] 前端列表页加载
- [ ] 前端详情页 4 Tab
- [ ] 前端响应式布局
- [ ] 种子数据 5 个服务
