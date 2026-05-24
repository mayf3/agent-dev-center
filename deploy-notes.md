# 部署说明（for itops-agent）

## 1. ADC 后端 (agent-dev-center)

### 变更内容
- `backend/src/routes/requirements.ts` — 新增 GET /api/requirements/kanban 端点
- `backend/src/routes/reports.ts` — 新增 GET /:reportId 单报告查询端点
- `backend/src/app.ts` — reportsRouter 双重挂载到 /api/requirements/:id/reports 和 /api/reports

### 构建命令
```bash
cd /Users/yanfenma/workspace/project/agent-dev-center/backend
npm run build
```

### 部署后验证
```bash
# 看板端点
curl http://localhost:4000/api/requirements/kanban

# 报告端点
curl http://localhost:4000/api/reports/<report-uuid>
```

## 2. LLM Todo (llm-todo)

### 变更内容
- `src/db.ts` — 新增 task_comments 表、task_relations 表、scheduled_at/snoozed_until 字段
- `src/routes/todo.ts` — 新增 comments API、relations API、waiting 状态机制、活动日志自动记录

### 构建命令
```bash
cd /Users/yanfenma/workspace/project/llm-todo
npm run build
docker build -t services-llm-todo:new .
# 替换现有容器
docker stop svc-llm-todo
docker rm svc-llm-todo
docker run -d --name svc-llm-todo \
  -p 3458:3458 \
  -v /path/to/data:/app/data \
  services-llm-todo:new
```

### 部署后验证
```bash
# 检查子状态/类型字段
curl http://localhost:3458/api/todos/1 | python3 -m json.tool

# 评论API
curl -X POST http://localhost:3458/api/todos/1/comments \
  -H "Content-Type: application/json" \
  -d '{"content":"测试评论","type":"comment"}'

# 关系API
curl http://localhost:3458/api/todos/1/relations

# 等待机制
curl -X PUT http://localhost:3458/api/todos/1 \
  -H "Content-Type: application/json" \
  -d '{"scheduled_at":"2026-06-01T00:00:00Z"}'
```
