#!/usr/bin/env bash
# ============================================================
# Redis 恢复脚本
# 用法：bash restore-redis.sh <备份文件.rdb.gz>
# 注意：恢复需要停止 Redis 容器替换 dump.rdb 后重启
# ============================================================
set -Eeuo pipefail

CONTAINER_NAME="agent-dev-center-redis-1"
APP_DIR="/opt/agent-dev-center"

if [ $# -lt 1 ]; then
  echo "用法: $0 <备份文件.rdb.gz> [--confirm]"
  echo ""
  echo "⚠️  此操作将替换 Redis 全部数据！"
  echo ""
  echo "可用备份："
  ls -lht /opt/backups/redis/*.rdb.gz 2>/dev/null | head -10
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "❌ 备份文件不存在: ${BACKUP_FILE}"
  exit 1
fi

if [ "$2" != "--confirm" ]; then
  echo "⚠️  即将恢复 Redis 数据"
  echo "   备份文件: ${BACKUP_FILE}"
  echo "   文件大小: $(du -h "${BACKUP_FILE}" | cut -f1)"
  echo ""
  echo "请加 --confirm 参数确认: $0 ${BACKUP_FILE} --confirm"
  exit 0
fi

echo "=== Redis 恢复开始 ==="

# 1. 停止依赖服务
echo "[1/4] 停止后端服务..."
cd "${APP_DIR}"
docker compose -f docker-compose.prod.yml stop backend redis

# 2. 替换 dump.rdb
echo "[2/4] 替换 dump.rdb..."
gunzip -c "${BACKUP_FILE}" > /tmp/dump.rdb
docker cp /tmp/dump.rdb "${CONTAINER_NAME}:/data/dump.rdb"
rm -f /tmp/dump.rdb

# 3. 启动 Redis
echo "[3/4] 启动 Redis..."
docker compose -f docker-compose.prod.yml start redis

# 等待 Redis 就绪
sleep 3
KEYS=$(docker exec "${CONTAINER_NAME}" redis-cli DBSIZE | awk '{print $2}')
echo "✅ Redis 恢复完成，key 数量: ${KEYS}"

# 4. 启动后端
echo "[4/4] 启动后端..."
docker compose -f docker-compose.prod.yml start backend

echo ""
echo "=== 恢复完成 ==="
