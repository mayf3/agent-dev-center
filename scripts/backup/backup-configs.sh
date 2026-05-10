#!/usr/bin/env bash
# ============================================================
# 配置文件备份脚本（Docker Compose + Nginx + .env）
# 策略：每日凌晨 3:20 打包，保留 7 天
# ============================================================
set -Eeuo pipefail

# ---------- 配置 ----------
APP_DIR="/opt/agent-dev-center"
BACKUP_DIR="/opt/backups/configs"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/configs_${TIMESTAMP}.tar.gz"
LOG_FILE="${BACKUP_DIR}/backup.log"

# ---------- 执行 ----------
mkdir -p "${BACKUP_DIR}"

echo "[${TIMESTAMP}] Starting config backup..."

# 打包关键配置文件
tar czf "${BACKUP_FILE}" \
  -C / \
  "${APP_DIR}/docker-compose.prod.yml" \
  "${APP_DIR}/docker-compose.yml" \
  "${APP_DIR}/.env.production" \
  "${APP_DIR}/scripts/" \
  /etc/nginx/sites-enabled/agent-dev-center \
  /etc/nginx/nginx.conf \
  2>/dev/null || true

if [ ! -s "${BACKUP_FILE}" ]; then
  echo "[${TIMESTAMP}] ERROR: Config backup file is empty!" >&2
  exit 1
fi

SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[${TIMESTAMP}] Config backup completed: ${BACKUP_FILE} (${SIZE})"

# 清理过期备份
DELETED=$(find "${BACKUP_DIR}" -name "*.tar.gz" -mtime +${RETENTION_DAYS} -print -delete | wc -l)
echo "[${TIMESTAMP}] Cleaned ${DELETED} backups older than ${RETENTION_DAYS} days"

echo "${TIMESTAMP} | Config | ${SIZE} | - | ${BACKUP_FILE}" >> "${LOG_FILE}"
