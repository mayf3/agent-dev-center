# Agent开发中心 - 生产部署文档

> 最后更新: 2026-05-09  
> 服务器: 8.163.44.127 (Ubuntu 24.04 LTS)  
> 部署路径: /opt/agent-dev-center

## 架构概览

```
Internet → [UFW Firewall :80/:443] → Host Nginx (80) → Docker Frontend (8080)
                                             ↓
                                      Docker Backend (4000)
                                      ↓            ↓
                                PostgreSQL (5432)  Redis (6379)
```

## 服务清单

| 服务 | 镜像 | 端口映射 | 网络 |
|------|------|----------|------|
| nginx (host) | nginx/1.24 | 80 → 80 | - |
| frontend | agent-dev-center-frontend:prod | 127.0.0.1:8080 → 80 | app |
| backend | agent-dev-center-backend:prod | 127.0.0.1:4000 → 4000 | app, db |
| postgres | postgres:16-alpine | 5432 (internal) | db |
| redis | redis:7-alpine | 6379 (internal) | db |

**网络设计**:
- `app` 网络: frontend ↔ backend 通信 (bridge)
- `db` 网络: backend ↔ postgres/redis (internal, 无外网访问)

## 访问地址

- 前端: http://8.163.44.127
- API健康检查: http://8.163.44.127/api/health
- 监控面板 (Netdata): http://8.163.44.127:19999

## 部署流程

### 一键部署

```bash
# 在项目根目录执行
./deploy.sh
```

deploy.sh 会自动完成:
1. SSH连接验证
2. 打包项目文件 (排除 .git, node_modules, dist)
3. 上传到服务器 /opt/agent-dev-center
4. Docker Compose 构建并启动

### 手动部署

```bash
# 1. 打包
tar --exclude='.git' --exclude='node_modules' --exclude='dist' -czf deploy.tar.gz .

# 2. 上传
scp deploy.tar.gz root@8.163.44.127:/tmp/

# 3. 在服务器上
ssh root@8.163.44.127
cd /opt/agent-dev-center
tar -xzf /tmp/deploy.tar.gz
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

## Nginx 配置

主机 Nginx 作为反向代理:
- `/` → 代理到 Docker frontend (127.0.0.1:8080)
- `/api` → 代理到 Docker backend (127.0.0.1:4000)
- `/health` → 直接返回 200

配置文件: `/etc/nginx/sites-available/agent-dev-center`

```bash
# 验证配置
nginx -t

# 重载
systemctl reload nginx
```

## 数据库备份

### 自动备份 (Cron)

- 脚本: `/opt/agent-dev-center/scripts/backup-postgres.sh`
- 频率: 每天 02:00
- 保留: 7天
- 目录: `/opt/backups/postgres/`

### 手动备份/恢复

```bash
# 备份
/opt/agent-dev-center/scripts/backup-postgres.sh

# 恢复
gunzip -c /opt/backups/postgres/agent_dev_center_YYYYMMDD_HHMMSS.sql.gz | \
  docker exec -i agent-dev-center-postgres-1 psql -U agent_dev -d agent_dev_center
```

## 常用运维命令

```bash
cd /opt/agent-dev-center

# 查看服务状态
docker compose -f docker-compose.prod.yml ps

# 查看日志
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f frontend

# 重启单个服务
docker compose -f docker-compose.prod.yml restart backend

# 完整重建
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d --build

# 进入容器调试
docker exec -it agent-dev-center-backend-1 sh
docker exec -it agent-dev-center-postgres-1 psql -U agent_dev -d agent_dev_center
```

## 监控

- **Netdata**: http://8.163.44.127:19999
  - CPU、内存、磁盘、网络实时监控
  - Docker容器指标
  - 进程级监控

- **Docker 健康检查**: 所有服务都配置了健康检查
  - postgres: pg_isready (10s间隔)
  - redis: redis-cli ping (10s间隔)
  - backend: HTTP /api/health (30s间隔)
  - frontend: wget /health (30s间隔)

- **日志轮转**: 所有容器配置 json-file 日志驱动
  - max-size: 10m
  - max-file: 3

## 防火墙规则 (UFW)

| 端口 | 协议 | 用途 |
|------|------|------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP (Nginx) |
| 443 | TCP | HTTPS (预留) |
| 19999 | TCP | Netdata 监控 |

## 安全说明

1. Docker端口仅绑定 127.0.0.1，外部无法直接访问容器
2. 数据库和Redis在 internal 网络中，无外网路由
3. Nginx 启用安全头 (X-Frame-Options, X-Content-Type-Options 等)
4. 所有容器启用 `no-new-privileges` 安全选项
5. .env.production 权限设为 600

## SSL 证书 (TODO - 域名就绪后配置)

域名备案完成后:
```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```
