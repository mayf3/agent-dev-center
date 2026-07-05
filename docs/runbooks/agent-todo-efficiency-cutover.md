# Agent Todo 效率管家身份切换 — 运维执行手册

> **版本**: V2（独立审计就绪）
> **工具**: `backend/src/scripts/cutover-agent-todo-efficiency-manager.ts`
> **本文档不含数据库密码、JWT、管理员密码或其他敏感凭据。**

---

## 1. Commit 确认

```
Baseline commit:  9fb0d1133b90e472206b71afea0f97be78e60a9b
Branch:          fix/agent-todo-efficiency-cutover-tool-v2
Commit SHA:      <将在实施前填入>
```

确认工作树干净：

```bash
cd <WORKTREE_DIR>
git status --short
# 应无输出
```

---

## 2. 前置条件检查清单

所有检查项在工具 `--dry-run` 中自动执行。手动确认项：

- [ ] `server/main` 仍为预期 commit
- [ ] 工作树干净，无未跟踪文件
- [ ] 无 `DATABASE_URL` shell 残留冲突
- [ ] 三条目标 Requirement UUID 已从生产 DB 精确查询确认
- [ ] 效率管家（toUser）User ID 已确认
- [ ] 管理员 User ID 和名称已确认
- [ ] Admin API 操作已独立验证（见第 4 节）

---

## 3. 数据库身份确认

工具通过以下参数强制数据库目标校验：

```
--expected-host <host>
--expected-database agent_dev_center
--expected-schema public
```

不满足时会返回 `BLOCKED_BY_DATABASE_TARGET_UNSAFE`。

> **注意**: `--expected-host` 必须使用生产环境实际的权威 host 别名，如 `postgres-authoritative`。不要硬编码为 `localhost`。

---

## 4. Admin API — User 角色变更（独立步骤）

本工具**不修改 User 表**。效率管家用户的 `internalRole` 变更为 `pm` 通过正式 Admin API 完成。

### 4.1 获取 Admin Token

```bash
# 使用正式登录 endpoint 获取 token
ADMIN_TOKEN=$(curl -fsS -X POST <AUTH_URL> \
  -H 'Content-Type: application/json' \
  -d '{"email":"<admin-email>","password":"<admin-password>"}' | jq -r '.token')

# Token 非空检查
if [ -z "$ADMIN_TOKEN" ]; then
  echo "TOKEN_EMPTY: 认证失败，停止。"
  exit 1
fi
```

### 4.2 执行角色变更

```bash
EFFICIENCY_USER_ID="<to-user-uuid>"

HTTP_CODE=$(curl -fsS -o /tmp/admin-response.json -w '%{http_code}' \
  -X PATCH "<API_BASE>/api/admin/users/$EFFICIENCY_USER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"internalRole":"pm"}')

if [ "$HTTP_CODE" != "200" ]; then
  echo "ADMIN_API_FAILED: HTTP $HTTP_CODE — 停止后续操作。"
  cat /tmp/admin-response.json
  exit 1
fi

# 验证响应字段
jq -e '.internalRole == "pm" and (.roles | index("adc:pm"))' /tmp/admin-response.json > /dev/null
if [ $? -ne 0 ]; then
  echo "ADMIN_API_RESPONSE_INVALID: 响应字段不符合预期。停止。"
  exit 1
fi

echo "✅ Admin API 成功: internalRole=pm, roles 包含 adc:pm"
```

### 4.3 验证

```bash
# 确认 role 保持 requester，okrRole 保持 okr_member
jq '{role: .role, okrRole: .okrRole, internalRole: .internalRole, roles: .roles, enabled: .enabled}' /tmp/admin-response.json
```

> **注意**: Admin API 设置 internalRole 后，效率管家的平台角色会发生对应变化（如 `adc:pm`）。
> 工具在执行 dry-run/apply 时会自动验证效率管家用户是否具有 agent-todo Folder 的访问权限：
> - 拥有 `adc:admin` 全局权限 → 自动通过
> - 否则要求用户的平台角色命中 `domain_role_bindings` 中 agent-todo 域的绑定角色
> - 不满足时返回 `BLOCKED_BY_TO_USER_FOLDER_ACCESS`

### 4.4 回滚命令

```bash
# 恢复 internalRole 为 null
curl -fsS -X PATCH "<API_BASE>/api/admin/users/$EFFICIENCY_USER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"internalRole":null}'
```

---

## 5. 环境准备

### 5.1 备份当前环境

```bash
cp .env.production .env.production.bak.$(date +%Y%m%d_%H%M%S)
```

### 5.2 确认 AGENT_TODO_EFFICIENCY_USER_ID

```bash
# 查看当前 .env.production 中该变量的值
grep 'AGENT_TODO_EFFICIENCY_USER_ID' .env.production || echo '（尚不存在）'
```

### 5.3 修改变量

```bash
# 只修改这一行
sed -i '' 's/^AGENT_TODO_EFFICIENCY_USER_ID=.*/AGENT_TODO_EFFICIENCY_USER_ID=<to-user-uuid>/' .env.production

# 如果不存在则追加
grep -q '^AGENT_TODO_EFFICIENCY_USER_ID=' .env.production || \
  echo "AGENT_TODO_EFFICIENCY_USER_ID=<to-user-uuid>" >> .env.production
```

### 5.4 脱敏验证

```bash
# 只显示 AGENT_TODO_EFFICIENCY_USER_ID 行，不暴露数据库密码
grep 'AGENT_TODO_EFFICIENCY_USER_ID' .env.production
```

---

## 6. Backend 重建

```bash
# 安装依赖
npm --workspace backend install

# 生成 Prisma Client
npm --workspace backend run prisma:generate

# 编译
npm --workspace backend run build
```

### 健康检查

```bash
curl -fsS http://localhost:4000/api/health | jq .
```

确认返回 `{"status":"ok"}`。

---

## 7. Dry-run

```bash
npx tsx backend/src/scripts/cutover-agent-todo-efficiency-manager.ts \
  --dry-run \
  --requirement-id <UUID1> \
  --requirement-id <UUID2> \
  --requirement-id <UUID3> \
  --from-user-id <from-user-uuid> \
  --to-user-id <to-user-uuid> \
  --actor-id <admin-user-uuid> \
  --actor-name "<管理员真实名称>" \
  --expected-host <生产权威host> \
  --expected-database agent_dev_center \
  --expected-schema public \
  --expected-agent-todo-count <N> \
  --expected-to-user-email <效率管家邮箱> \
  --expected-from-user-name MAYF3 \
  --env-file .env.production
```

**预期输出**:
- 所有前置条件通过 ✅
- "Dry-run 完成，未写入任何数据"
- operationId 已生成（记录到运行日志）

**阻断状态**:
- `BLOCKED_BY_DATABASE_TARGET_UNSAFE` — 数据库目标不匹配
- `BLOCKED_BY_INSTANCE_STATE_CHANGED` — 某条 Requirement 状态已变化
- `BLOCKED_BY_INVALID_ACTOR` — Actor 不符合要求

---

## 8. Apply

只在 Dry-run 全部通过、Admin API 已完成、环境变量已准备好的情况下执行。

```bash
npx tsx backend/src/scripts/cutover-agent-todo-efficiency-manager.ts \
  --apply \
  --requirement-id <UUID1> \
  --requirement-id <UUID2> \
  --requirement-id <UUID3> \
  --from-user-id <from-user-uuid> \
  --to-user-id <to-user-uuid> \
  --actor-id <admin-user-uuid> \
  --actor-name "<管理员真实名称>" \
  --expected-host <生产权威host> \
  --expected-database agent_dev_center \
  --expected-schema public \
  --expected-agent-todo-count <N> \
  --expected-to-user-email <效率管家邮箱> \
  --expected-from-user-name MAYF3 \
  --env-file .env.production
```

### 记录 operationId

```bash
# 从输出中提取 operationId 并记录到安全位置
OPERATION_ID="<从输出获取的operationId>"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) operationId=$OPERATION_ID" >> /var/log/cutover-operation.log
```

---

## 9. 数据库验证

### 9.1 确认数据正确性

```sql
-- 确认三条 Requirement 已正确修正
SELECT id, assignee_id, assignee, state_version, current_step
FROM requirements
WHERE id IN ('<UUID1>', '<UUID2>', '<UUID3>');

-- 确认 workflow_snapshot 中效率管家已变更
SELECT id,
  workflow_snapshot->'roleUserMap'->>'efficiency-manager' AS eff_manager,
  workflow_snapshot->'roleUserMap'->>'lobster-partner' AS lob_partner,
  workflow_snapshot->'roleUserMap'->>'executor' AS executor
FROM requirements
WHERE id IN ('<UUID1>', '<UUID2>', '<UUID3>');
```

### 9.2 确认 AuditLog

```sql
SELECT id, action, actor_id, actor_name, details->>'operationId' AS op_id
FROM audit_logs
WHERE details->>'operationId' = '<OPERATION_ID>';
```

---

## 10. 正式 API 验收

### 10.1 列表验收

```bash
# domainKey 过滤
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "<API_BASE>/api/requirements?domainKey=agent-todo" | jq '.data | length'
```

### 10.2 详情验收

```bash
# 逐条确认 assignee 已变更
for ID in <UUID1> <UUID2> <UUID3>; do
  curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
    "<API_BASE>/api/requirements/$ID" | jq '{id: .id, assigneeId: .assigneeId, assignee: .assignee, currentStep: .currentStep}'
done
```

### 10.3 效率管家 My Tasks

```bash
# 使用效率管家 token 登录后查看 /mine
curl -fsS -H "Authorization: Bearer $EFFICIENCY_TOKEN" \
  "<API_BASE>/api/requirements/mine" | jq '.data | length'
# 应返回 3
```

### 10.4 MyStep 验证

```bash
for ID in <UUID1> <UUID2> <UUID3>; do
  curl -fsS -H "Authorization: Bearer $EFFICIENCY_TOKEN" \
    "<API_BASE>/api/requirements/$ID/workflow/myStep" | jq '{canOperate: .data.canOperate, currentStep: .data.currentStep.name}'
done
# canOperate 应为 true
```

> **注意**: 验收不得调用 `advance` 或 `reject`。

---

## 11. Rollback

仅在需要恢复时执行。

```bash
npx tsx backend/src/scripts/cutover-agent-todo-efficiency-manager.ts \
  --rollback \
  --operation-id <之前记录的OPERATION_ID> \
  --actor-id <admin-user-uuid> \
  --actor-name "<管理员真实名称>" \
  --expected-host <生产权威host> \
  --expected-database agent_dev_center \
  --expected-schema public \
  --expected-agent-todo-count <N> \
  --env-file .env.production
```

**阻断状态**:
- `BLOCKED_BY_ROLLBACK_PRECONDITION` — 工作流已推进、已有 Transition/Report
- `BLOCKED_BY_DATABASE_TARGET_UNSAFE` — 数据库目标不匹配

---

## 12. 所有阻断状态

| 状态码 | 含义 | 处理 |
|--------|------|------|
| `BLOCKED_BY_DATABASE_TARGET_UNSAFE` | 数据库目标不匹配 | 检查 host/database/schema 参数 |
| `BLOCKED_BY_INSTANCE_STATE_CHANGED` | 目标 Requirement 状态已变化 | 确认是否可继续，联系负责人 |
| `BLOCKED_BY_INVALID_ACTOR` | Actor 无效或权限不足 | 确认正确的管理员身份 |
| `BLOCKED_BY_ROLLBACK_PRECONDITION` | 工作流已推进，不可回滚 | 手动评估是否需要恢复 |
| `BLOCKED_BY_TO_USER_FOLDER_ACCESS` | 效率管家无 agent-todo Folder 访问权限 | 确认 Admin API 已设置正确平台角色，或拥有 adc:admin 全局权限 |
| `BLOCKED_BY_MAIN_ADVANCE` | 基线 commit 已变更 | 重新 fetch 并审计 |
| `BLOCKED_BY_TEST_FAILURE` | 测试未通过 | 修复后重新执行 |
| `BLOCKED_BY_STRUCTURE_GUARD` | 目录/文件结构不符合规范 | 修复后重新执行 |

---

## 13. 并发窗口

实施期间需确保：

```
NO_PUSH_TODOS_CALLED
NO_NEW_AGENT_TODO_CREATED
```

工具在 transaction 前后检测 Agent Todo 总数是否匹配 `--expected-agent-todo-count`。数量变化时拒绝写入。

---

## 14. 凭据事件

```
PRODUCTION_DATABASE_CREDENTIAL_EXPOSED_IN_PRIOR_RUNBOOK
ROTATION_REQUIRED_AS_SEPARATE_OPERATION
```

本次切换不执行凭据轮换。轮换必须作为独立操作在后续完成。

---

## 15. 实施后验证摘要

- [ ] `GET /api/requirements?domainKey=agent-todo` 返回 3 条
- [ ] `GET /api/requirements/:id` 确认 `assigneeId` 为效率管家
- [ ] `GET /api/requirements/mine`（效率管家 token）返回 3 条
- [ ] `GET /api/requirements/:id/workflow/myStep` 确认 `canOperate = true`
- [ ] AuditLog 存在 3 条 `REQUIREMENT_ROLE_MIGRATED`
- [ ] 三条 `operationId` 相同
- [ ] `stateVersion` 分别 +1
- [ ] 未修改 `lobster-partner`、`executor`、`currentStep`
- [ ] 未创建 Transition 或 Report
