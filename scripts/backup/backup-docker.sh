#!/usr/bin/env bash
# ============================================================
# Docker 容器与镜像备份脚本
# 策略：每周日凌晨 4:00 保存镜像 + 容器运行状态，保留 2 份
# 注意：镜像文件较大，仅保留最近 2 周
# ============================================================
set -Eeuo pipefail

# ---------- 配置 ----------
BACKUP_DIR="/opt/backups/docker"
RETENTION_COUNT=2  # 保留最近 2 份
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${BACKUP_DIR}/backup.log"

# ---------- 执行 ----------
mkdir -p "${BACKUP_DIR}"

echo "[${TIMESTAMP}] Starting Docker backup..."

# 1. 保存容器运行状态
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' > "${BACKUP_DIR}/container-status_${TIMESTAMP}.txt"

# 2. 保存 docker-compose 配置中引用的镜像
IMAGES=$(docker ps --format '{{.Image}}' | sort -u)
IMAGE_FILE="${BACKUP_DIR}/images_${TIMESTAMP}.tar"

echo "[${TIMESTAMP}] Saving images: ${IMAGES}"
docker save ${IMAGES} -o "${IMAGE_FILE}" 2>/dev/null

if [ -s "${IMAGE_FILE}" ]; then
  SIZE=$(du -h "${IMAGE_FILE}" | cut -f1)
  gzip -f "${IMAGE_FILE}"
  echo "[${TIMESTAMP}] Docker images saved: ${IMAGE_FILE}.gz (${SIZE})"
else
  echo "[${TIMESTAMP}] WARNING: No images saved" >&2
  rm -f "${IMAGE_FILE}"
fi

# 3. 保存 Docker volume 列表
docker volume ls --format '{{.Name}}' > "${BACKUP_DIR}/volumes_${TIMESTAMP}.txt"

# 4. 清理旧备份（保留最近 RETENTION_COUNT 份）
for PATTERN in "container-status_" "images_" "volumes_"; do
  COUNT=$(find "${BACKUP_DIR}" -name "${PATTERN}*" | wc -l)
  if [ "$COUNT" -gt "$RETENTION_COUNT" ]; then
    find "${BACKUP_DIR}" -name "${PATTERN}*" -printf '%T+ %p\n' | sort | head -n -$((RETENTION_COUNT)) | awk '{print $2}' | xargs rm -f
    echo "[${TIMESTAMP}] Cleaned old ${PATTERN} backups"
  fi
done

echo "${TIMESTAMP} | Docker | - | - | ${BACKUP_DIR}" >> "${LOG_FILE}"
