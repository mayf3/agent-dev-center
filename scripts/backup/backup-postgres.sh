#!/usr/bin/env bash
# ============================================================
# PostgreSQL 每日备份脚本
# 目标：agent-dev-center PostgreSQL 16 Alpine (Docker)
# 策略：每日凌晨 3:00 全量 pg_dump，保留 7 天
# ============================================================
set -Eeuo pipefail

# ---------- 配置 ----------
CONTAINER_NAME="agent-dev-center-postgres-1"
DB_NAME="agent_dev_center"
DB_USER="agent_dev"
BACKUP_DIR="/opt/backups/postgres"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"
LOG_FILE="${BACKUP_DIR}/backup.log"

# ---------- 执行 ----------
mkdir -p "${BACKUP_DIR}"

echo "[${TIMESTAMP}] Starting PostgreSQL backup..."

# pg_dump 全量导出（--clean --if-exists 确保恢复时可覆盖）
docker exec "${CONTAINER_NAME}" \
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" \
    --clean --if-exists --no-owner --no-privileges \
  | gzip > "${BACKUP_FILE}"

# 校验备份文件
if [ ! -s "${BACKUP_FILE}" ]; then
  echo "[${TIMESTAMP}] ERROR: Backup file is empty!" >&2
  exit 1
fi

SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
ROWS=$(docker exec "${CONTAINER_NAME}" \
  psql -U "${DB_USER}" -d "${DB_NAME}" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")

echo "[${TIMESTAMP}] PostgreSQL backup completed: ${BACKUP_FILE} (${SIZE}, ${ROWS} tables)"

# 清理过期备份
DELETED=$(find "${BACKUP_DIR}" -name "*.sql.gz" -mtime +${RETENTION_DAYS} -print -delete | wc -l)
echo "[${TIMESTAMP}] Cleaned ${DELETED} backups older than ${RETENTION_DAYS} days"

# 记录日志
echo "${TIMESTAMP} | PG | ${SIZE} | ${ROWS} tables | ${BACKUP_FILE}" >> "${LOG_FILE}"
