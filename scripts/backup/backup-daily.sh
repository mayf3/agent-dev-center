#!/usr/bin/env bash
# ============================================================
# 全量备份入口脚本（每日调用）
# 按顺序执行：PostgreSQL → Redis → Configs
# Docker 镜像备份由独立的周 cron 调用
# ============================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="/opt/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
MASTER_LOG="${LOG_DIR}/backup-master.log"

echo "========================================" >> "${MASTER_LOG}"
echo "[${TIMESTAMP}] === Daily backup started ===" >> "${MASTER_LOG}"

# PostgreSQL
if bash "${SCRIPT_DIR}/backup-postgres.sh" >> "${MASTER_LOG}" 2>&1; then
  echo "[${TIMESTAMP}] ✅ PostgreSQL backup OK" >> "${MASTER_LOG}"
else
  echo "[${TIMESTAMP}] ❌ PostgreSQL backup FAILED (exit $?)" >> "${MASTER_LOG}"
fi

# Redis
if bash "${SCRIPT_DIR}/backup-redis.sh" >> "${MASTER_LOG}" 2>&1; then
  echo "[${TIMESTAMP}] ✅ Redis backup OK" >> "${MASTER_LOG}"
else
  echo "[${TIMESTAMP}] ❌ Redis backup FAILED (exit $?)" >> "${MASTER_LOG}"
fi

# Configs
if bash "${SCRIPT_DIR}/backup-configs.sh" >> "${MASTER_LOG}" 2>&1; then
  echo "[${TIMESTAMP}] ✅ Config backup OK" >> "${MASTER_LOG}"
else
  echo "[${TIMESTAMP}] ❌ Config backup FAILED (exit $?)" >> "${MASTER_LOG}"
fi

echo "[${TIMESTAMP}] === Daily backup completed ===" >> "${MASTER_LOG}"
echo "========================================" >> "${MASTER_LOG}"
