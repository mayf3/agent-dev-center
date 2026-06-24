# ADC Backend — Canonical 构建与开发路径

`backend/` 是 ADC 的唯一 canonical 构建和开发路径。

## Canonical 路径

| 用途 | 路径 | 说明 |
|---|---|---|
| Prisma Schema | `backend/prisma/schema.prisma` | 唯一真实 schema |
| Migration | `backend/prisma/migrations/` | 唯一 migration 目录 |
| TypeScript 源码 | `backend/src/` | 所有业务代码 |
| 编译产物 | `backend/dist/` | TypeScript 编译输出 |
| Dockerfile | `Dockerfile`（根目录） | 只 `COPY backend/` |
| 测试 | `backend/src/__tests__/` | Vitest 测试 |

## 已废弃的根目录路径

以下路径存在于仓库历史但**不在构建上下文中**，不应在生产或 CI 中引用：

- `src/` — 已废弃，使用 `backend/src/`
- `prisma/` — 已废弃，使用 `backend/prisma/`

## CI 路径校验

```bash
bash scripts/verify-canonical-paths.sh
```

在 PR/CI 中调用此脚本可检测是否错误引用了废弃路径。
