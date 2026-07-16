#!/usr/bin/env bash
# ============================================================
# PostgreSQL 恢复脚本
# 用法：bash restore-postgres.sh <备份文件.sql.gz>
# 示例：bash restore-postgres.sh /opt/backups/postgres/agent_dev_center_20260510_030001.sql.gz
# ============================================================
set -Eeuo pipefail

CONTAINER_NAME="agent-dev-center-postgres-1"
DB_NAME="agent_dev_center"
DB_USER="agent_dev"
APP_DIR="/opt/agent-dev-center"

# ---------- 参数校验 ----------
if [ $# -lt 1 ]; then
  echo "用法: $0 <备份文件.sql.gz> [--confirm]"
  echo ""
  echo "⚠️  此操作将清空并恢复数据库！请先用 --confirm 参数确认。"
  echo ""
  echo "可用备份："
  ls -lht /opt/backups/postgres/*.sql.gz 2>/dev/null | head -10
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "❌ 备份文件不存在: ${BACKUP_FILE}"
  exit 1
fi

if [ "$2" != "--confirm" ]; then
  echo "⚠️  即将恢复数据库: ${DB_NAME}"
  echo "   备份文件: ${BACKUP_FILE}"
  echo "   文件大小: $(du -h "${BACKUP_FILE}" | cut -f1)"
  echo ""
  echo "请加 --confirm 参数确认执行: $0 ${BACKUP_FILE} --confirm"
  exit 0
fi

# ---------- 恢复流程 ----------
echo "=== PostgreSQL 恢复开始 ==="
echo "备份文件: ${BACKUP_FILE}"
echo "目标数据库: ${DB_NAME}"
echo "时间: $(date)"
echo ""

# 1. 断开应用连接（停止 backend）
echo "[1/5] 停止后端服务..."
cd "${APP_DIR}"
docker compose -f docker-compose.prod.yml stop backend
echo "✅ 后端已停止"

# 2. 断开所有现有连接
echo "[2/5] 断开数据库现有连接..."
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid<>pg_backend_pid();" 2>/dev/null || true

# 3. 恢复数据
echo "[3/5] 恢复数据..."
gunzip -c "${BACKUP_FILE}" | docker exec -i "${CONTAINER_NAME}" \
  psql -U "${DB_USER}" -d "${DB_NAME}" 2>&1 | tail -5

# 4. 验证
echo "[4/5] 验证恢复结果..."
TABLES=$(docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
echo "✅ 恢复完成，public schema 表数量: ${TABLES}"

# 5. 重启后端
echo "[5/5] 重启后端服务..."
docker compose -f docker-compose.prod.yml start backend
echo "✅ 后端已启动"

echo ""
echo "=== 恢复完成 ==="
echo "请验证应用功能是否正常。"
