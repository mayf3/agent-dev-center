## 事故验尸报告：SSO_JWT_SECRET 多值不同步（2026-05-24，第二次重演）

### 现象
LLM Todo（效率管家）客户端验证 ADC 签发的 SSO JWT 令牌失败，报鉴权错误。

### 根因分析（5 个为什么）

**为什么 1：** SSO 令牌验证失败？因为 ADC 签令牌用的密钥和 LLM Todo 验证用的密钥不同。

**为什么 2：** 为什么密钥不同？因为 ADC 的 compose 文件中使用 `JWT_SECRET_SSO: ${JWT_SECRET_SSO:-prod-sso-secret-at-least-16-chars-here}` 即默认占位符值，而根 `docker-compose.yml` 给 LLM Todo 传递的是 `SSO_JWT_SECRET=prod-jwt-secret-at-least-16-chars-here`（另一个占位符），LLM Todo 本地 `.env` 又是 `995684a18ca3d73fe83e36b324d26fb3b21f563a92a813c625b0ee9d680a0b53`（又一个值）。

**为什么 3：** 为什么有三个不同值？因为 SSO 密钥配置散落在 3 个位置，改了一个没改另外两个。

**为什么 4：** 为什么 5/20 的验尸教训（"SSO 只用一个签名密钥"）没有起作用？因为当时的修复只新增了 `JWT_SECRET_SSO` 环境变量字段和代码支持，但没有统一清理所有配置点的占位符。根 docker-compose.yml 里的 `SSO_JWT_SECRET=prod-jwt-secret-at-least-16-chars-here` 从未被替换为真实密钥。

**为什么 5：** 为什么不能有一个"唯一的秘密源"？因为配置是静态的、分散的，C 级变更时需要手动同步多处的 `docker-compose.yml`、`.env`、`.env.production` 文件，没有机制保证一致性。

### 为什么现有流程没拦住
1. 5/20 的验尸教训只修复了"代码层"（统一用了 `JWT_SECRET_SSO` 变量），没有清理"配置层"（各 compose 文件里的占位符）
2. 没有自动化检查：多个 compose 文件间的 SSO_JWT_SECRET 值是否一致
3. 没有全链路 SSO 集成测试：部署后没有自动验证从 ADC 签发令牌到其他服务验证通过的全流程

### 提取的长期原则
1. **SSO 密钥必须只定义在一处，其他位置引用同一值**：`POSTGRES_PASSWORD` 类似的密码也适用。建议在根 docker-compose 目录放一个 `.env` 文件定义所有共享密钥。
2. **验尸教训的"落地"不只是加代码，还要做配置审计**：检查所有配置文件、环境变量定义中的相关值是否都已更新。
3. **全链路 SSO 集成测试**：每次 SSO 相关变更后，必须验证：ADC 登录 → 获取令牌 → 其他服务用令牌访问 → 返回 200（而非 401/403）。

### 预防措施
1. ✅ 已修复：所有 3 处配置统一为同一值
2. ✅ 已修复：ADC docker-compose.yml 中 `JWT_SECRET_SSO` 硬编码为实际值，不再依赖环境变量替换
3. ✅ 已修复：所有敏感环境变量（JWT_SECRET, JWT_REFRESH_SECRET, JWT_EXPIRES_IN, FRONTEND_ORIGIN）在 compose 中硬编码为实际值
4. 🔲 待做：自动化全链路 SSO 测试脚本（login → call /todo/api/projects）
5. 🔲 待做：Long-term 方案见 docs/sso-unified-secret-design.md
