# DEPRECATED: 根目录 prisma/

## 状态

**已废弃。请勿在此目录新增或修改任何文件。**

## 原因

ADC 的 canonical Prisma schema 和 migration 已统一到 `backend/prisma/`。

此根 `prisma/` 目录：

- 不在 `Dockerfile` 构建上下文中
- 仓库中真正的 schema 是 `backend/prisma/schema.prisma`
- migration 都在 `backend/prisma/migrations/` 中

## 当前处理

- 保留此目录仅用于历史引用兼容
- 所有 Prisma 命令应显式指定 `--schema backend/prisma/schema.prisma`
- 所有新 migration 请写入 `backend/prisma/migrations/`
- 根 `prisma/` 在后续清理阶段将被整体删除

## 相关文档

- `backend/prisma/schema.prisma` — canonical Prisma schema
- `scripts/verify-canonical-paths.sh` — CI 路径校验脚本
