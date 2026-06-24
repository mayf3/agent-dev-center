#!/usr/bin/env bash
# ============================================================
# 本地拉取备份脚本（在本机 macOS 上运行）
# 从阿里云服务器 rsync 最新备份到本地
# ============================================================
set -Eeuo pipefail

REMOTE_HOST="root@{your-server-ip}"
REMOTE_BASE="/opt/backups"
LOCAL_BASE="{home}/workspace/backup/agent-dev-center"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 创建本地目录
for DIR in postgres redis configs docker; do
  mkdir -p "${LOCAL_BASE}/${DIR}"
done

echo "[${TIMESTAMP}] Syncing backups from ${REMOTE_HOST}..."

# PostgreSQL 备份
rsync -avz --progress "${REMOTE_HOST}:${REMOTE_BASE}/postgres/*.sql.gz" "${LOCAL_BASE}/postgres/"
echo "✅ PostgreSQL backups synced"

# Redis 备份
rsync -avz --progress "${REMOTE_HOST}:${REMOTE_BASE}/redis/*.rdb.gz" "${LOCAL_BASE}/redis/" 2>/dev/null || echo "⚠️ No Redis backups yet"
echo "✅ Redis backups synced"

# 配置备份
rsync -avz --progress "${REMOTE_HOST}:${REMOTE_BASE}/configs/*.tar.gz" "${LOCAL_BASE}/configs/" 2>/dev/null || echo "⚠️ No config backups yet"
echo "✅ Config backups synced"

# Docker 备份（仅同步清单文件，镜像太大走专线）
rsync -avz --progress \
  "${REMOTE_HOST}:${REMOTE_BASE}/docker/container-status_*.txt" \
  "${REMOTE_HOST}:${REMOTE_BASE}/docker/volumes_*.txt" \
  "${LOCAL_BASE}/docker/" 2>/dev/null || true

# 本地保留 30 天（比服务器多保留）
find "${LOCAL_BASE}" -name "*.gz" -mtime +30 -delete 2>/dev/null
find "${LOCAL_BASE}" -name "*.txt" -mtime +30 -delete 2>/dev/null

# 记录同步时间
echo "${TIMESTAMP}" > "${LOCAL_BASE}/last-sync.txt"
echo ""
echo "✅ All backups synced to ${LOCAL_BASE}"
echo "   Last sync: $(date)"
