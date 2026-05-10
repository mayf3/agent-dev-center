#!/usr/bin/env bash
# ============================================================
# Redis 备份脚本
# 目标：agent-dev-center Redis 7 Alpine (Docker)
# 策略：每日凌晨 3:10 手动 BGSAVE + 复制 dump.rdb，保留 7 天
# ============================================================
set -Eeuo pipefail

# ---------- 配置 ----------
CONTAINER_NAME="agent-dev-center-redis-1"
BACKUP_DIR="/opt/backups/redis"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/dump_${TIMESTAMP}.rdb.gz"
LOG_FILE="${BACKUP_DIR}/backup.log"

# ---------- 执行 ----------
mkdir -p "${BACKUP_DIR}"

echo "[${TIMESTAMP}] Starting Redis backup..."

# 触发 BGSAVE
docker exec "${CONTAINER_NAME}" redis-cli BGSAVE

# 等待 BGSAVE 完成（最多 60 秒）
TIMEOUT=60
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  BGSAVE_STATUS=$(docker exec "${CONTAINER_NAME}" redis-cli LASTSAVE)
  sleep 1
  NEW_STATUS=$(docker exec "${CONTAINER_NAME}" redis-cli LASTSAVE)
  if [ "$BGSAVE_STATUS" != "$NEW_STATUS" ]; then
    break
  fi
  ELAPSED=$((ELAPSED + 1))
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo "[${TIMESTAMP}] WARNING: BGSAVE did not complete within ${TIMEOUT}s, copying last save" >&2
fi

# 从 Docker volume 中复制 dump.rdb
# Redis volume 挂载点在容器内 /data/dump.rdb
docker cp "${CONTAINER_NAME}:/data/dump.rdb" - | gzip > "${BACKUP_FILE}"

if [ ! -s "${BACKUP_FILE}" ]; then
  echo "[${TIMESTAMP}] ERROR: Redis backup file is empty!" >&2
  exit 1
fi

SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
KEYS=$(docker exec "${CONTAINER_NAME}" redis-cli DBSIZE | awk '{print $2}')

echo "[${TIMESTAMP}] Redis backup completed: ${BACKUP_FILE} (${SIZE}, ${KEYS} keys)"

# 清理过期备份
DELETED=$(find "${BACKUP_DIR}" -name "*.rdb.gz" -mtime +${RETENTION_DAYS} -print -delete | wc -l)
echo "[${TIMESTAMP}] Cleaned ${DELETED} backups older than ${RETENTION_DAYS} days"

echo "${TIMESTAMP} | Redis | ${SIZE} | ${KEYS} keys | ${BACKUP_FILE}" >> "${LOG_FILE}"
