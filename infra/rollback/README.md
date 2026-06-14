# Docker 部署回滚机制

## 概述

提供 Docker 容器化部署的版本备份与一键回滚能力。

**当前阶段（3 个月目标）**：docker tag 备份 + 健康检查脚本
- 部署前自动将当前 `latest` 镜像标记为 `previous`
- 部署失败自动回滚到 `previous` 版本
- 支持手动一键回滚
- 多服务健康检查

## 文件

| 文件 | 用途 |
|------|------|
| `deploy-with-rollback.sh` | 带自动回滚的部署脚本（核心） |
| `rollback.sh` | 手动一键回滚脚本 |
| `health-check.sh` | 多服务健康检查脚本 |

## 快速使用

### 部署（带自动回滚）

```bash
# 部署 ADC 后端
bash deploy-with-rollback.sh agent-dev-center-backend backend

# 部署并跳过数据库迁移
bash deploy-with-rollback.sh agent-dev-center-backend backend --skip-migrate
```

### 手动回滚

```bash
# 查看哪些服务可以回滚
bash rollback.sh

# 回滚指定服务
bash rollback.sh agent-dev-center-backend

# 仅检查是否有可回滚的镜像（不执行回滚）
bash rollback.sh agent-dev-center-backend --check-only
```

### 健康检查

```bash
# 检查所有服务
bash health-check.sh

# 检查指定服务
bash health-check.sh agent-dev-center-backend

# 持续监控模式（每 5s 刷新）
bash health-check.sh --watch
```

## 工作流程

```
deploy-with-rollback.sh
    │
    ├─ 1. docker tag latest → previous （备份）
    ├─ 2. git pull server main         （拉代码）
    ├─ 3. docker compose build         （构建）
    ├─ 4. prisma migrate deploy        （迁移）
    ├─ 5. docker compose up -d         （启动）
    └─ 6. health check × 6             （验证）
         │
         ├─ ✅ 通过 → 部署成功
         └─ ❌ 失败 → 自动回滚
                        │
                        ├─ docker tag previous → latest
                        ├─ docker compose up -d
                        └─ health check 再次验证
```

## 镜像标签说明

| 标签 | 含义 |
|------|------|
| `:latest` | 当前运行的生产版本 |
| `:previous` | 上一版本（用于回滚） |

每次部署时，当前的 `:latest` 会被自动备份为 `:previous`，然后构建新的 `:latest`。

## 部署日志

部署操作记录在服务器 `/var/log/deploy/deploy.log`：

```
2026-06-14 18:30:00 | agent-dev-center-backend | a1b2c3d | SUCCESS
2026-06-14 19:00:00 | agent-dev-center-backend | e4f5g6h | ROLLBACK_SUCCESS
```

## 已支持服务

| 服务名 | 健康检查 URL |
|--------|-------------|
| agent-dev-center-backend | http://localhost:4000/api/health |
| auth-service | http://localhost:3001/health |
| llm-todo-service | http://localhost:3458/health |
| svc-okr | http://localhost:3459/health |

## 后续演进

- **6 个月**：Registry 镜像版本管理 + 自动回滚（支持回滚到任意版本）
- **12 个月**：迁移 K8s 实现原生 rollback
