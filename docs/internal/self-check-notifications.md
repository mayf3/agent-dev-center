# DEV_SELF_CHECK — ADC 微信小程序通知功能

> 检查日期: 2026-05-25
> 检查人: miniapp-game-engineer
> 项目: Agent Dev Center 微信小程序
> 需求: f8a77757 ADC 微信小程序版（通知功能增强）

---

## 一、功能清单

### 新增

| 功能 | 文件 | 状态 |
|------|------|------|
| 通知列表页 | `pages/notifications/` (4 文件) | ✅ |
| 通知 TabBar | app.json — 第3个 Tab "通知" | ✅ |
| 未读角标 | app.js — 30s 轮询 + 自动更新 | ✅ |
| 单条标记已读 | PATCH /api/notifications/:id | ✅ |
| 全部已读 | POST /api/notifications/read-all | ✅ |
| 点击跳转关联需求 | navigateTo requirement-detail | ✅ |
| 下拉刷新 | onPullDownRefresh | ✅ |
| 上拉加载更多 | onReachBottom (分页) | ✅ |
| 登录后自动启动轮询 | login/index.js | ✅ |

### 修改

| 文件 | 变更 | 状态 |
|------|------|------|
| app.json | 新增 pages/notifications/index + TabBar 第3项 | ✅ |
| app.js | 新增 startUnreadPolling / stopUnreadPolling / _fetchUnreadCount | ✅ |
| pages/login/index.js | 登录成功后调用 startUnreadPolling | ✅ |

## 二、后端 API 依赖

| 端点 | 方法 | 用途 | 状态 |
|------|------|------|------|
| /api/notifications | GET | 通知列表（分页，unread 过滤） | ✅ 已实现 |
| /api/notifications/stream | GET | SSE 实时推送（小程序暂不使用） | ✅ 已实现 |
| /api/notifications/unread-count | GET | 未读数 | ✅ 已实现 |
| /api/notifications/:id | PATCH | 标记已读 | ✅ 已实现 |
| /api/notifications/read-all | POST | 全部已读 | ✅ 已实现 |

## 三、编译检查

- [x] WeChat DevTools 打开项目成功
- [x] 所有页面路径正确
- [x] TabBar 3 项（需求 / 我的任务 / 通知）
- [x] 8 个页面全部注册

## 四、已知问题

1. 使用 touristappid，无法真机预览/上传
2. 需真实 AppID 和域名备案后才能发布
3. SSE 实时推送暂未集成（小程序后台不支持长连接），采用 30s 轮询代替

---

**提交人**: miniapp-game-engineer
**状态**: 待审批
