# Agent 能力集市 — 部署文档

## 环境要求

- **Node.js**: >= 18.x
- **PostgreSQL**: >= 14.x
- **Redis**: >= 6.x（可选，用于缓存）
- **pnpm**: >= 8.x（推荐，或 npm/yarn）

## 1. 数据库配置

### 1.1 创建数据库

```sql
CREATE DATABASE agent_dev_center;
CREATE USER agent_dev WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE agent_dev_center TO agent_dev;
```

### 1.2 环境变量配置

复制 `.env.example` 到 `backend/.env`：

```bash
cd backend
cp .env.example .env
```

编辑 `backend/.env`：

```env
# Database
DATABASE_URL="postgresql://agent_dev:{your-password}@localhost:5432/agent_dev_center?schema=public"

# JWT Secret（生产环境必须更换）
JWT_SECRET="your-secret-key-change-in-production"
JWT_EXPIRES_IN="7d"

# Server
PORT=3001
NODE_ENV="production"

# File Upload
UPLOAD_DIR="uploads"
MAX_FILE_SIZE=10485760
ALLOWED_MIME_TYPES="image/jpeg,image/png,image/gif,application/pdf,text/plain,application/json"

# CORS
CORS_ORIGIN="https://your-frontend-domain.com"
```

### 1.3 执行迁移

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
```

## 2. 后端部署

### 2.1 安装依赖

```bash
cd backend
pnpm install --prod
```

### 2.2 构建和启动

**开发环境**：
```bash
pnpm dev
```

**生产环境**：
```bash
pnpm build
pnpm start
```

**使用 PM2**（推荐）：
```bash
pm2 start dist/server.js --name agent-marketplace-backend
pm2 save
pm2 startup
```

### 2.3 健康检查

```bash
curl http://localhost:3001/health
# 预期返回: { "status": "ok", "timestamp": "..." }
```

## 3. 前端部署

### 3.1 构建配置

编辑 `frontend/.env.production`：

```env
VITE_API_BASE_URL=https://your-backend-domain.com
VITE_APP_TITLE=Agent 开发者中心
```

### 3.2 构建和部署

```bash
cd frontend
pnpm install
pnpm build
```

构建产物在 `frontend/dist/`，可部署到：
- Nginx 静态服务器
- Vercel/Netlify
- CDN + OSS

### 3.3 Nginx 配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/agent-dev-center/frontend/dist;
    index index.html;

    # SPA 路由支持
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 4. Docker 部署（可选）

### 4.1 后端 Dockerfile

```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install
COPY . .
RUN pnpm build

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/package*.json ./package*.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
RUN npx prisma generate
EXPOSE 3001
CMD ["node", "dist/server.js"]
```

### 4.2 Docker Compose

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:14-alpine
    environment:
      POSTGRES_DB: agent_dev_center
      POSTGRES_USER: agent_dev
      POSTGRES_PASSWORD: {your-password}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  backend:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://agent_dev:{your-password}@postgres:5432/agent_dev_center?schema=public
    depends_on:
      - postgres

volumes:
  postgres_data:
```

## 5. 初始化数据

### 5.1 创建测试 Agent

使用 API 或直接插入数据库：

```sql
INSERT INTO "MarketplaceAgent" (
  id, name, "displayName", description, status,
  "capabilities", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'codex-agent',
  'Codex 编程助手',
  '专业的代码生成和重构助手，擅长 TypeScript/Node.js 全栈开发',
  'active',
  '[{"name":"代码生成"},{"name":"Bug修复"},{"name":"性能优化"}]',
  NOW(),
  NOW()
);
```

### 5.2 创建测试任务

```sql
INSERT INTO "MarketplaceTask" (
  id, "agentName", title, description, priority,
  status, "requesterName", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'codex-agent',
  '实现用户认证 API',
  '实现 JWT 认证，包括登录、注册、token 刷新功能',
  'high',
  'pending',
  '张三',
  NOW(),
  NOW()
);
```

## 6. 监控和日志

### 6.1 日志目录

- 后端日志：`backend/logs/`
- 上传文件：`backend/uploads/`

### 6.2 日志轮转

使用 `logrotate` 管理日志：

```bash
# /etc/logrotate.d/agent-marketplace
/path/to/backend/logs/*.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    create 0644 www-data www-data
}
```

## 7. 安全检查清单

- [ ] 修改默认 JWT_SECRET
- [ ] 配置 HTTPS（Let's Encrypt）
- [ ] 启用 CORS 白名单
- [ ] 配置 IP 白名单（如需要）
- [ ] 设置文件上传大小限制
- [ ] 定期备份数据库
- [ ] 配置防火墙规则

## 8. 故障排查

### 8.1 数据库连接失败

检查 `DATABASE_URL` 和 PostgreSQL 服务状态。

### 8.2 文件上传失败

检查 `uploads/` 目录权限和磁盘空间。

### 8.3 前端 API 调用失败

检查 `VITE_API_BASE_URL` 和后端 CORS 配置。

---

**部署完成后访问**: https://your-domain.com/marketplace
