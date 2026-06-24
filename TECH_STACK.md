# Agent Dev Center — 技术栈声明

> 本文档声明项目使用的技术栈，**禁止混用其他技术栈**。

## 后端 (backend/)

| 层级 | 技术 | 版本 |
|------|------|------|
| Runtime | Node.js | v20+ |
| 语言 | TypeScript | strict mode |
| 框架 | Express | 4.x |
| ORM | Prisma | 6.x |
| 数据库 | PostgreSQL | 15+ |
| 认证 | JWT (jsonwebtoken) + bcrypt | — |
| 校验 | Zod | 3.x |
| 测试 | Vitest | — |

## 前端 (frontend/)

| 层级 | 技术 | 版本 |
|------|------|------|
| Runtime | Node.js | v20+ |
| 语言 | TypeScript | strict mode |
| 框架 | React | 18.x |
| UI库 | Ant Design | 5.x |
| 构建 | Vite | 5.x |
| 路由 | React Router | 6.x |

## 基础设施

- **部署**: Docker + Nginx 反向代理
- **端口**: 后端 4000, 前端 80/443
- **SSO**: ADC 自身作为统一认证 Provider

## ❌ 禁止引入

- Python / Go / Java 等其他语言后端
- MongoDB / MySQL 等其他数据库
- GraphQL（REST API 优先）
