# Agent Dev Center 备份与恢复方案

> 服务器：8.163.44.127 (Ubuntu 24.04) | 制定日期：2026-05-10 | 负责人：ITOps Agent

---

## 一、备份策略总览

| 备份对象 | 备份方式 | 频率 | 保留天数 | 脚本 |
|----------|----------|------|----------|------|
| **PostgreSQL** | `pg_dump --clean --if-exists` + gzip | 每日 03:00 | 7 天 | `backup-postgres.sh` |
| **Redis** | BGSAVE + `docker cp dump.rdb` + gzip | 每日 03:10 | 7 天 | `backup-redis.sh` |
| **配置文件** | tar.gz 打包 (docker-compose, .env, nginx) | 每日 03:20 | 7 天 | `backup-configs.sh` |
| **Docker 镜像** | `docker save` + gzip | 每周日 04:00 | 2 份 | `backup-docker.sh` |

### 备份文件存储位置

| 位置 | 路径 | 说明 |
|------|------|------|
| **服务器** | `/opt/backups/{postgres,redis,configs,docker}/` | 阿里云磁盘 |
| **本地** | `/Users/yanfenma/workspace/backup/agent-dev-center/` | 本机手动拉取 |

### 本地拉取

```bash
# 在本机执行
bash /Users/yanfenma/workspace/project/agent-dev-center/scripts/backup/pull-backup-local.sh
```

可加入 macOS crontab 或 launchd 定时执行（建议每日 08:00）。

---

## 二、Crontab 配置（服务器端）

```crontab
# === Agent Dev Center 备份任务 ===
# 每日备份（PostgreSQL + Redis + 配置）
0 3 * * * /opt/agent-dev-center/scripts/backup/backup-daily.sh >> /opt/backups/backup-master.log 2>&1

# Docker 镜像备份（每周日）
0 4 * * 0 /opt/agent-dev-center/scripts/backup/backup-docker.sh >> /opt/backups/docker/backup-cron.log 2>&1
```

### 部署步骤

```bash
# 1. 上传脚本到服务器
scp scripts/backup/*.sh root@8.163.44.127:/opt/agent-dev-center/scripts/backup/

# 2. 赋予执行权限
ssh root@8.163.44.127 "chmod +x /opt/agent-dev-center/scripts/backup/*.sh"

# 3. 删除旧 crontab，写入新配置
ssh root@8.163.44.127 "crontab -l | grep -v backup-postgres | grep -v backup-daily | grep -v backup-docker > /tmp/cron.tmp; cat >> /tmp/cron.tmp << 'EOF'
0 3 * * * /opt/agent-dev-center/scripts/backup/backup-daily.sh >> /opt/backups/backup-master.log 2>&1
0 4 * * 0 /opt/agent-dev-center/scripts/backup/backup-docker.sh >> /opt/backups/docker/backup-cron.log 2>&1
EOF
crontab /tmp/cron.tmp && rm /tmp/cron.tmp"

# 4. 创建备份目录
ssh root@8.163.44.127 "mkdir -p /opt/backups/{postgres,redis,configs,docker}"

# 5. 手动执行一次验证
ssh root@8.163.44.127 "bash /opt/agent-dev-center/scripts/backup/backup-daily.sh"
```

---

## 三、恢复操作手册

### 3.1 PostgreSQL 恢复

```bash
# 1. 查看可用备份
ssh root@8.163.44.127 "ls -lht /opt/backups/postgres/*.sql.gz | head -10"

# 2. 预览确认（不加 --confirm 只显示信息）
ssh root@8.163.44.127 \
  "bash /opt/agent-dev-center/scripts/backup/restore-postgres.sh /opt/backups/postgres/agent_dev_center_XXXXXXXX_XXXXXX.sql.gz"

# 3. 确认执行恢复
ssh root@8.163.44.127 \
  "bash /opt/agent-dev-center/scripts/backup/restore-postgres.sh /opt/backups/postgres/agent_dev_center_XXXXXXXX_XXXXXX.sql.gz --confirm"
```

**恢复流程**：停止后端 → 断开连接 → 导入数据 → 验证表数量 → 重启后端

**预计停机时间**：1-3 分钟（取决于数据量）

### 3.2 Redis 恢复

```bash
# 查看可用备份
ssh root@8.163.44.127 "ls -lht /opt/backups/redis/*.rdb.gz | head -10"

# 确认执行
ssh root@8.163.44.127 \
  "bash /opt/agent-dev-center/scripts/backup/restore-redis.sh /opt/backups/redis/dump_XXXXXXXX_XXXXXX.rdb.gz --confirm"
```

**恢复流程**：停止后端+Redis → 替换 dump.rdb → 启动 Redis → 启动后端

**预计停机时间**：30-60 秒

### 3.3 配置文件恢复

```bash
# 查看可用备份
ssh root@8.163.44.127 "ls -lht /opt/backups/configs/*.tar.gz | head -10"

# 恢复
ssh root@8.163.44.127 \
  "tar xzf /opt/backups/configs/configs_XXXXXXXX_XXXXXX.tar.gz -C /"
```

### 3.4 Docker 全环境恢复（灾难恢复）

适用于服务器重装或迁移场景：

```bash
# 1. 恢复配置
tar xzf configs_XXXXXXXX_XXXXXX.tar.gz -C /

# 2. 加载镜像
docker load -i images_XXXXXXXX.tar.gz

# 3. 启动服务
cd /opt/agent-dev-center
docker compose -f docker-compose.prod.yml up -d

# 4. 恢复数据库（等 postgres 健康检查通过后）
bash /opt/agent-dev-center/scripts/backup/restore-postgres.sh /opt/backups/postgres/XXXXX.sql.gz --confirm

# 5. 恢复 Redis
bash /opt/agent-dev-center/scripts/backup/restore-redis.sh /opt/backups/redis/XXXXX.rdb.gz --confirm
```

---

## 四、备份监控与告警

### 日志文件

| 日志 | 路径 |
|------|------|
| 主日志 | `/opt/backups/backup-master.log` |
| PostgreSQL | `/opt/backups/postgres/backup.log` |
| Redis | `/opt/backups/redis/backup.log` |
| Config | `/opt/backups/configs/backup.log` |
| Docker | `/opt/backups/docker/backup.log` |

### 快速检查

```bash
# 一键检查所有备份状态
ssh root@8.163.44.127 "echo '=== PG ==='; ls -lht /opt/backups/postgres/*.sql.gz | head -3; echo '=== Redis ==='; ls -lht /opt/backups/redis/*.rdb.gz | head -3; echo '=== Config ==='; ls -lht /opt/backups/configs/*.tar.gz | head -3; echo '=== Docker ==='; ls -lht /opt/backups/docker/images_*.tar.gz 2>/dev/null | head -3; echo '=== Last Run ==='; tail -10 /opt/backups/backup-master.log"
```

---

## 五、恢复演练方案

### 演练频率：**每月一次**（每月第一个周日上午）

### 演练清单

| 序号 | 检查项 | 预期结果 | 通过 |
|------|--------|----------|------|
| 1 | 备份文件完整性 | gzip -t 测试通过 | ☐ |
| 2 | PostgreSQL 恢复到测试库 | 表数量与生产一致 | ☐ |
| 3 | Redis 恢复到测试容器 | key 数量与生产一致 | ☐ |
| 4 | 配置文件解压验证 | 文件完整无缺 | ☐ |
| 5 | 应用启动验证 | 健康检查通过 | ☐ |
| 6 | 数据一致性验证 | 抽样对比关键数据 | ☐ |
| 7 | 本地拉取验证 | rsync 成功同步 | ☐ |

### 演练步骤（不影响生产）

```bash
# 1. 验证备份文件完整性
ssh root@8.163.44.127 "gzip -t /opt/backups/postgres/agent_dev_center_*.sql.gz && echo '✅ PG backup valid'"

# 2. 恢复到测试库（不覆盖生产）
ssh root@8.163.44.127 "docker exec agent-dev-center-postgres-1 psql -U agent_dev -d postgres -c 'DROP DATABASE IF EXISTS test_restore;'"
ssh root@8.163.44.127 "docker exec agent-dev-center-postgres-1 psql -U agent_dev -d postgres -c 'CREATE DATABASE test_restore;'"
ssh root@8.163.44.127 "gunzip -c /opt/backups/postgres/agent_dev_center_*.sql.gz | docker exec -i agent-dev-center-postgres-1 psql -U agent_dev -d test_restore" 2>&1 | tail -5

# 3. 对比表数量
ssh root@8.163.44.127 "echo 'Production:'; docker exec agent-dev-center-postgres-1 psql -U agent_dev -d agent_dev_center -tAc 'SELECT count(*) FROM information_schema.tables WHERE table_schema=\"public\";'; echo 'Restored:'; docker exec agent-dev-center-postgres-1 psql -U agent_dev -d test_restore -tAc 'SELECT count(*) FROM information_schema.tables WHERE table_schema=\"public\";'"

# 4. 清理测试库
ssh root@8.163.44.127 "docker exec agent-dev-center-postgres-1 psql -U agent_dev -d postgres -c 'DROP DATABASE test_restore;'"
```

---

## 六、注意事项

1. **Redis RDB 限制**：Redis BGSAVE 是快照备份，可能丢失最后一次 save 到 crash 之间的数据。如需更高持久性，可考虑开启 AOF（但会增加磁盘 IO，1.6GB 内存机器需评估）
2. **磁盘空间**：当前磁盘使用 29%（11G/40G），剩余 27G。PostgreSQL 备份约 2-3KB（数据量小），Docker 镜像备份较大（约 500MB-1GB），注意监控
3. **恢复窗口**：当前数据量小，恢复均在秒级。数据增长后需评估恢复时间
4. **加密**：备份文件未加密，如需更高安全性，可在 gzip 后追加 `gpg --symmetric` 加密
5. **异地容灾**：当前只有阿里云单节点 + 本地 rsync，如需更高可用性，建议接入阿里云 OSS 或其他对象存储
