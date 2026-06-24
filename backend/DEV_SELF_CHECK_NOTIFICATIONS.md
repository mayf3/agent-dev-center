# DEV_SELF_CHECK — 消息通知机制 (SSE + 数据库)

**项目**: agent-dev-center（需求管理平台）
**开发者**: 后端开发工程师 (agent-dev-engineer)
**完成时间**: 2026-05-12 16:30 GMT+8

---

## 1. 需求覆盖

| 需求项 | 状态 | 说明 |
|--------|------|------|
| notifications 表 | ✅ | PostgreSQL，支持 userId/type/title/content/relatedReqId/isRead |
| 通知列表 API | ✅ | GET /api/notifications (分页 + 未读筛选) |
| SSE 实时推送 | ✅ | GET /api/notifications/stream (心跳 30s) |
| 标记已读 | ✅ | PATCH /api/notifications/:id |
| 全部已读 | ✅ | POST /api/notifications/read-all |
| 删除通知 | ✅ | DELETE /api/notifications/:id |
| 未读数查询 | ✅ | GET /api/notifications/unread-count |
| 状态变更通知 | ✅ | 需求状态变更 + 任务创建/删除/状态变更 + 报告提交/审批 |

---

## 2. 触发事件清单

| 事件 | 触发位置 | 接收方 |
|------|---------|--------|
| `requirement.submitted` | routes/requirements.ts | 管理员广播 |
| `requirement.status_changed` | routes/requirements.ts | 需求提出者 + 负责人 |
| `requirement.updated` | routes/requirements.ts | 管理员广播 |
| `task.created` | routes/tasks.ts | 任务负责人 |
| `task.status_changed` | routes/tasks.ts | 管理员广播 |
| `task.deleted` | routes/tasks.ts | 管理员广播 |
| `report.submitted` | routes/reports.ts | 管理员广播 |
| `report.approved` | routes/reports.ts | 管理员广播 |
| `report.rejected` | routes/reports.ts | 管理员广播 |

---

## 3. 数据库变更

### 新增表 `notifications`

```sql
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,                          -- NULL = 广播通知
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "relatedReqId" UUID,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- 索引
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");
CREATE INDEX "notifications_type_idx" ON "notifications"("type");
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");
```

---

## 4. API 端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | /api/notifications | ✅ | 通知列表 (分页: page, limit, unread) |
| GET | /api/notifications/stream | ✅ | SSE 实时推送 |
| GET | /api/notifications/unread-count | ✅ | 未读数量 |
| PATCH | /api/notifications/:id | ✅ | 标记已读 |
| POST | /api/notifications/read-all | ✅ | 全部已读 |
| DELETE | /api/notifications/:id | ✅ | 删除通知 |

---

## 5. SSE 实现

### 连接流程
```
Client → GET /api/notifications/stream (with JWT Bearer token)
       ← event: connected → { userId, timestamp }
       ← event: notification → { id, title, content }
       ← event: heartbeat → { ts }  (每 30s)
```

### 架构
```
notifyEvent()
  ├─ 1. 写入 PostgreSQL notifications 表
  ├─ 2. SSE 推送 → sseClients Map (按 userId 分组)
  ├─ 3. 飞书 Webhook (可选, 保留原有)
  └─ 4. Agent Callback (可选, 保留原有)
```

---

## 6. 代码变更清单

### 修改文件

| 文件 | 变更 |
|------|------|
| `prisma/schema.prisma` | 新增 Notification model |
| `src/utils/notifications.ts` | 重写：+ 数据库写入 + SSE 推送 + 广播路由 |
| `src/app.ts` | 注册 notificationsRouter |
| `src/routes/reports.ts` | + notifyEvent 调用 (report.submitted/approved/rejected) |
| `src/routes/tasks.ts` | + assigneeId 参数 |

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/routes/notifications.ts` | 6 个通知 API 端点 |
| `prisma/migrations/[...]_add_notifications/` | 数据库迁移 |

---

## 7. 安全设计

| 检查项 | 状态 | 说明 |
|--------|------|------|
| JWT 认证 | ✅ | 所有通知 API 需要 authRequired |
| 用户隔离 | ✅ | SSE 只推送当前用户的通知 |
| 分页保护 | ✅ | limit 限制 1-50 |
| URL 校验 | ✅ | notifyEvent 保留 HTTPS 校验 |
| 飞书 SSRF 防护 | ✅ | assertHttpsUrl 函数 |

---

## 8. 前端集成指南

### 连接 SSE
```typescript
// 在 TopNav 组件中
const eventSource = new EventSource('/api/notifications/stream', {
  withCredentials: true
});

eventSource.addEventListener('notification', (event) => {
  const data = JSON.parse(event.data);
  // 更新未读计数 + 弹出通知
});

eventSource.addEventListener('heartbeat', () => {
  // 心跳保活
});
```

### 铃铛组件示例
```tsx
function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  
  // SSE 连接
  useEffect(() => {
    const es = new EventSource('/api/notifications/stream');
    es.addEventListener('notification', (e) => {
      const notif = JSON.parse(e.data);
      setUnreadCount(c => c + 1);
      setNotifications(prev => [notif, ...prev]);
    });
    return () => es.close();
  }, []);

  return (
    <Badge count={unreadCount}>
      <BellOutlined onClick={() => showDrawer()} />
    </Badge>
  );
}
```

---

## 9. 测试结果

### TypeScript 编译
```
$ npx tsc --noEmit
(无输出)
```
✅ 通过

### 代码变更
- 修改 5 文件，新增 2 文件
- 总计 ~400 行

---

## 10. 总结

✅ notifications 表 + 迁移
✅ 6 个通知 API 端点
✅ SSE 实时推送 (心跳保活)
✅ 8 种事件类型 + 触发逻辑
✅ 数据库持久化 + 实时推送并行
✅ 用户隔离 + JWT 认证
✅ TypeCheck 通过
✅ 兼容飞书 + Agent Callback

**状态**: 已完成，待 Review
**部署要求**: 需要运行 Prisma migration
