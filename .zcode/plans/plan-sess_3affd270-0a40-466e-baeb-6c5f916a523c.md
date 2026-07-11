## 根因分析

**`backend/src/src/` 不在仓库中存在（Case B）** — 由部署脚本生成。

### 根因证据链

1. **源码路径**: `backend/src/` (TypeScript source, `rootDir: "."`)
2. **构建输出**: `backend/dist/src/server.js` (tsc with `outDir: "dist"`, `rootDir: "."`)
3. **运行时入口**: `node dist/src/server.js` (via `backend/package.json` `start` or `start:migrate`)
4. **Dockerfile**: Multi-stage build, 生产阶段只复制 `backend/dist/`、`backend/prisma/`、`backend/package.json`，不会产生嵌套
5. **Docker CMD**: `["npm", "--workspace", "@agent-dev-center/backend", "run", "start:migrate"]` → `node dist/src/server.js`
6. **Root `deploy.sh`** (line 161): `tar -xzf "${REMOTE_ARCHIVE}" -C "${REMOTE_DIR}"` — 解压到**长期复用的共享目录**，不会清理旧文件
7. **累积覆盖模式**: tar 只覆盖同名文件，不会删除旧 release 中不存在于新 archive 的目录。如果历史上有人手动创建 `backend/src/src/`，后续部署不会自动清除
8. **`scripts/deploy.sh` 和 `infra/rollback/deploy-with-rollback.sh`**: 使用 `git pull` + `docker compose build`，理论上干净，但也没有守卫

### 根因判断

**root `deploy.sh` 的累积式 tar 解压模式（line 161）是根因**。在长期复用且未清理的生产源码目录上重复覆盖复制，旧版残留保持不动。

`workflowSnapshot` 回退逻辑已存在于 `server/main` (commit 69ccfc1)，但生产加载了旧版代码（`backend/src/src/` 路径），导致 `workflow advance/reject` 返回 "该需求未分配工作流" HTTP 400。

### 修改范围

| 文件 | 修改内容 |
|------|---------|
| `deploy.sh` | 原子 release 模式 + 守卫 |
| `scripts/deploy.sh` | 守卫 + build arg |
| `infra/rollback/deploy-with-rollback.sh` | 守卫 + build arg |
| `Dockerfile` | 接受 BUILD_COMMIT/BUILD_TIMESTAMP |
| `backend/src/routes/health.ts` | 输出版本标识 |
| `scripts/deploy-guard.sh` | **新文件**：部署守卫脚本 |
| `backend/src/__tests__/workflow-snapshot-advance-reject.test.ts` | **新文件**：verify workflowSnapshot fallback |

### 具体步骤

#### Step 1: 修复 root `deploy.sh` — 原子 release

在远程执行块中：
- **解压前**清理旧 backend 目录: `rm -rf backend 2>/dev/null || true`（archive 总是包含 `backend/`，安全）
- **提取到 staging 目录**然后原子性 mv 到 release 目录
- **解压后守卫**: `test ! -d backend/src/src`
- **Docker build 后守卫**: 验证 entrypoint 文件存在
- **传递 commit SHA 和 timestamp**: 加到 compose build 的 `--build-arg`

#### Step 2: 添加版本标识

- `Dockerfile`: 添加 `ARG BUILD_COMMIT` / `ARG BUILD_TIMESTAMP` 并 `ENV`
- `backend/src/routes/health.ts`: 在 JSON 响应中添加 `buildCommit`, `buildTimestamp`, `runtimeEntry`
- deploy 脚本通过 `--build-arg` 注入 commit SHA

#### Step 3: 添加部署守卫脚本 `scripts/deploy-guard.sh`

可被所有 deploy 脚本调用的守卫：
- `test ! -d backend/src/src` 或递归检查嵌套
- 验证 entrypoint 路径不含 `src/src`
- 验证 `backend/package.json` 的 `start`/`start:migrate` 指向正确路径
- 失败退出码非零，部署中止

#### Step 4: workflowsnapshot advance/reject 测试

新建 `backend/src/__tests__/workflow-snapshot-advance-reject.test.ts`，验证：
1. relation 存在时正常 advance
2. relation 不存在、snapshot 存在时正常 advance
3. relation 和 snapshot 都不存在时仍返回 400
4. snapshot 格式无效时安全拒绝
5. Domain/Auth 和角色权限不被绕过
6. advance 成功创建 WorkflowTransition
7. advance 成功创建 WORKFLOW_ADVANCED Ledger
8. reject 成功创建 WorkflowTransition
9. reject 成功创建 WORKFLOW_REJECTED Ledger
10. CAS、Transition 或 Ledger 失败时事务整体回滚

#### Step 5: 运行全部门禁

```bash
# Backend
npm --workspace backend run prisma:generate
npm --workspace backend run typecheck
npm --workspace backend run build

# Frontend  
npm --workspace frontend run typecheck
npm --workspace frontend run build
npm --workspace frontend run test
```

#### Step 6: 提交

两个 scoped commits:
1. `fix: prevent nested backend source deployment and add guards`
2. `test: verify production runtime workflow snapshot fallback`

### 不处理事项（按需求文档）

- ❌ 修改 Schema / migrations
- ❌ 生产部署
- ❌ 修改 workflowSnapshot 业务规则
- ❌ rebase / force push
- ❌ 历史 Ledger 回填
- ❌ 生产数据库操作
