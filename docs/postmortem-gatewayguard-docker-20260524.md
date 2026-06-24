## 事故验尸报告：ADC 平台 502/403 网关守卫 Docker 不兼容

### 现象
2026-05-24 周日，产品经理报告 ADC 平台无法访问（http://{your-server-ip} 返回 502/403）。实际表现为：
- 前端页面正常加载（HTTP 200）
- 所有 API 请求被 403 拦截，返回 `"Direct access is not allowed"`

### 根因分析
**为什么 1：** API 返回 403，提示 "Direct access is not allowed"？因为 `gatewayGuard` 中间件在生产环境拦截了所有外部 API 请求。

**为什么 2：** 之前能正常工作，为什么突然不行了？因为容器被重启了（up 6 hours）。

**为什么 3：** gatewayGuard 的逻辑是什么？它检查 `req.socket.remoteAddress`，如果等于 `127.0.0.1` 或 `::1`，认为请求来自 Nginx 反向代理，放行。否则继续检查 `X-Forwarded-For` 中的真实客户端 IP 是否在 RFC 1918 私有网段内。

**为什么 4：** 为什么 socket address 不是 127.0.0.1？Docker 端口映射的工作方式：宿主机的 `127.0.0.1:4000` 被 Docker 代理（docker-proxy）转发到容器内。从容器内看，连接源 IP 是 **Docker 网桥网关**（如 `172.17.0.1` / `172.22.0.1`），不是 `127.0.0.1`。

**所以完整链路：**
1. Nginx 通过 `127.0.0.1:4000` 代理请求 → Docker 端口映射 → 容器
2. 容器内 socket source address = 172.22.0.1（Docker 网桥网关）
3. `gatewayGuard` 只检查 `socketAddr === '127.0.0.1'` → 不匹配
4. 回退到检查 `X-Forwarded-For` 中的真实客户端 IP（外部公网 IP）→ 不在 RFC 1918 → 403

### 为什么现有流程没拦住
1. **开发环境不暴露此问题**：`gatewayGuard` 在 `NODE_ENV !== 'production'` 时跳过，本地开发看不到这个 403。
2. **部署前没有 Docker 模拟测试**：DEV_SELF_CHECK 和测试报告都是在本地开发环境中跑的，没有在生产环境的 Docker 容器 + Nginx 组合下验证过。
3. **没有生产环境的 "全链路 API 可达性" 测试**：Docker 部署后没有自动 curl 验证 API 端点是否 200。

### 提取的长期原则
1. **Docker 容器内 socket IP ≠ localhost**：Docker 端口映射后，容器内看到的源 IP 是 Docker 网桥网关（如 172.17.0.x/172.22.0.x），不是 `127.0.0.1`。任何检查本地连接的逻辑都必须覆盖 RFC 1918 私有网段。
2. **部署验证必须包含全链路 API 可达性检查**：DEV_SELF_CHECK 的 deploymentVerification 字段必须覆盖 "通过 Nginx 代理访问" 这一层，不能只测试容器内 localhost 直连。
3. **中间件中的安全白名单应该用 CIDR 范围，不是精确 IP**：所有涉及 IP 白名单的场景，优先用 CIDR 范围匹配，避免 Docker 网络模式带来的 IP 差异。

### 预防措施
1. ✅ 已修复：`gatewayGuard` 的 socket address 检查从 `=== '127.0.0.1'` 改为用 `PRIVATE_RANGES`（含 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16）匹配。
2. 待做：ADC 部署 CI/CD 中加入生产环境全链路 API 可达性检查（通过 Nginx 代理 curl 验证 API 返回 200/401 而非 403/502）。
3. 待做：docker-compose.yml 加入 `HEALTHCHECK`，健康检查通过 Nginx 代理路径验证（如 `curl -f http://localhost/api/health`）。

### 文件变更
- `backend/src/middleware/ip-whitelist.ts`：`gatewayGuard` 的 socket check 改为 CIDR 范围匹配
- `backend/dist/src/middleware/ip-whitelist.js`：对应编译文件
