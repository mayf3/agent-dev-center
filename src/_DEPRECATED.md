# DEPRECATED: 根目录 src/

## 状态

**已废弃。请勿在此目录新增或修改任何文件。**

## 原因

ADC 的 canonical 构建路径已统一为 `backend/`。生产 Docker 镜像只从 `backend/` 目录构建。此根 `src/` 目录存在于仓库历史中但：

- 不在 `Dockerfile` 构建上下文中
- 无任何生产脚本或 CI 管道引用
- 根 `package.json` 不存在

## 当前处理

- 保留此目录仅用于历史引用兼容（若有外部工具引用此路径）
- 所有新代码请写入 `backend/src/`
- 根 `src/` 在后续清理阶段将被整体删除

## 相关文档

- `backend/README.md` — canonical 构建和开发指南
- `scripts/verify-canonical-paths.sh` — CI 路径校验脚本
