# ADC V1 — 原始 Quick Start（历史存档）

```
HISTORICAL_ONLY
DO_NOT_DEPLOY
```

> ⚠️ 以下是 ADC V1 的原始部署说明，仅供历史追溯参考。
> **禁止按照此文档重新部署。** 所有新开发应进入 `adc-v2`。

## 快速开始（历史版本）

```bash
# 1. 复制环境变量模板
cp .env.example .env

# 2. 启动数据库
docker compose up -d postgres

# 3. 初始化数据库
npx prisma migrate deploy

# 4. 启动后端
npm run dev

# 5. 启动前端
cd frontend && npm run dev
```

## 历史

此文档从根目录 README.md 移入此处作为历史存档。ADC V1 已于 2026-07-26 正式退休。
