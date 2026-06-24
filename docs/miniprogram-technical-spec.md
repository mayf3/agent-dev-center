# Agent开发中心 - 微信小程序技术方案

> 文档编号: TASK-007  
> 作者: miniapp-game-engineer  
> 日期: 2026-05-09  
> 状态: 待评审

---

## 一、需求理解

### 1.1 业务背景

Agent开发中心是一个需求驱动的开发管理平台，Web端已实现完整功能（React + Ant Design + Express + PostgreSQL）。现需开发微信小程序版本，让用户在移动端也能提交需求、查看进度、管理任务。

### 1.2 核心业务流程

```
提交需求 → CTO审核 → 分配开发Agent → 开发 → 测试 → 验收 → 完成
```

### 1.3 目标用户与角色

| 角色 | 权限 | 小程序核心操作 |
|------|------|----------------|
| CTO (admin) | 全部权限 | 审核需求、分配任务、查看看板、拒绝需求 |
| 需求提交者 (requester) | 提需求、查看进度 | 提交需求、查看自己的需求、编辑待审核需求 |
| 开发Agent (developer) | 查看任务、更新状态 | 查看分配给自己的任务、更新任务状态 |

### 1.4 Web端功能对照

| Web端页面 | 功能 | 小程序优先级 |
|-----------|------|-------------|
| 仪表盘 | 统计概览、最近更新列表 | P1 |
| 需求列表 | 搜索、筛选、分页 | P1 |
| 提交需求 | 表单提交 | P1 |
| 需求详情 | 详情展示、审核操作、任务列表 | P1 |
| 开发看板 | 拖拽看板、状态流转 | P2（移动端交互需重新设计） |
| 登录/注册 | 邮箱+密码 | P1（增加微信授权登录） |

---

## 二、技术方案

### 2.1 技术选型：微信小程序原生开发

**选择原生而非 uni-app/Taro 的理由：**

1. **项目规模适中** — 6个核心页面，原生开发足够高效
2. **性能最优** — 无框架抽象层，首屏加载和运行时性能最佳
3. **微信能力直接调用** — 微信登录、分享等能力无需适配
4. **维护成本低** — 无第三方框架升级/兼容性风险
5. **团队熟悉度** — 已有小游戏开发经验，原生API上手快

### 2.2 项目结构

```
miniprogram/
├── app.js                    # App入口（全局登录态管理）
├── app.json                  # 全局配置（tabBar、页面路由）
├── app.wxss                  # 全局样式
├── sitemap.json
├── project.config.json
├── utils/
│   ├── request.js            # 网络请求封装（token管理、错误处理）
│   ├── auth.js               # 登录态管理（微信登录 + token）
│   ├── constants.js          # 常量定义（状态、优先级映射）
│   └── format.js             # 格式化工具（日期、文本）
├── components/
│   ├── requirement-card/     # 需求卡片组件（列表/看板复用）
│   ├── status-tag/           # 状态标签组件
│   ├── priority-tag/         # 优先级标签组件
│   ├── empty-state/          # 空状态组件
│   └── login-modal/          # 登录弹窗组件
├── pages/
│   ├── dashboard/            # 仪表盘
│   │   ├── index.js
│   │   ├── index.wxml
│   │   ├── index.wxss
│   │   └── index.json
│   ├── requirements/         # 需求列表
│   │   ├── index.js
│   │   ├── index.wxml
│   │   ├── index.wxss
│   │   └── index.json
│   ├── requirement-detail/   # 需求详情
│   │   ├── index.js
│   │   ├── index.wxml
│   │   ├── index.wxss
│   │   └── index.json
│   ├── requirement-submit/   # 提交需求
│   │   ├── index.js
│   │   ├── index.wxml
│   │   ├── index.wxss
│   │   └── index.json
│   ├── kanban/               # 开发看板（滑动式）
│   │   ├── index.js
│   │   ├── index.wxml
│   │   ├── index.wxss
│   │   └── index.json
│   └── login/                # 登录页
│       ├── index.js
│       ├── index.wxml
│       ├── index.wxss
│       └── index.json
└── assets/
    └── icons/                # TabBar图标
```

### 2.3 全局配置 (app.json)

```json
{
  "pages": [
    "pages/dashboard/index",
    "pages/requirements/index",
    "pages/kanban/index",
    "pages/requirement-detail/index",
    "pages/requirement-submit/index",
    "pages/login/index"
  ],
  "tabBar": {
    "color": "#999",
    "selectedColor": "#1677ff",
    "backgroundColor": "#fff",
    "borderStyle": "white",
    "list": [
      {
        "pagePath": "pages/dashboard/index",
        "text": "首页",
        "iconPath": "assets/icons/home.png",
        "selectedIconPath": "assets/icons/home-active.png"
      },
      {
        "pagePath": "pages/requirements/index",
        "text": "需求",
        "iconPath": "assets/icons/list.png",
        "selectedIconPath": "assets/icons/list-active.png"
      },
      {
        "pagePath": "pages/kanban/index",
        "text": "看板",
        "iconPath": "assets/icons/board.png",
        "selectedIconPath": "assets/icons/board-active.png"
      }
    ]
  },
  "window": {
    "navigationBarTitleText": "Agent开发中心",
    "navigationBarBackgroundColor": "#1677ff",
    "navigationBarTextStyle": "white"
  }
}
```

---

## 三、核心功能设计

### 3.1 登录方案：微信授权 + 账号绑定

小程序不能直接使用Web端的邮箱+密码登录。设计如下：

**方案：微信静默登录 + 后端绑定**

```
1. 小程序启动 → wx.login() 获取 code
2. 发送 code 到后端 POST /api/auth/wechat-login
3. 后端用 code 换取 openid
   - 如果 openid 已绑定用户 → 直接返回 token ✅
   - 如果 openid 未绑定 → 返回需要绑定 → 展示绑定页面（输入邮箱+密码）
4. 绑定成功后 → 后端关联 openid 与用户 → 返回 token
```

**后端新增接口：**

```
POST /api/auth/wechat-login
Body: { code: string }
Response:
  - 已绑定: { token, user, bound: true }
  - 未绑定: { bound: false, openid }

POST /api/auth/wechat-bind
Body: { openid: string, email: string, password: string }
Response: { token, user }
```

> ⚠️ 此方案需要后端配合开发，需与后端工程师协调。

### 3.2 网络请求封装 (utils/request.js)

```javascript
// 核心设计
const BASE_URL = 'https://api.example.com/api'  // 需备案域名

class Request {
  constructor() {
    this._queue = []  // 请求队列
  }

  // Token 管理
  getToken() { return wx.getStorageSync('token') }
  setToken(token) { wx.setStorageSync('token', token) }
  clearToken() { wx.removeStorageSync('token') }

  // 统一请求方法
  request(options) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: BASE_URL + options.url,
        method: options.method || 'GET',
        data: options.data,
        header: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json'
        },
        success: (res) => {
          if (res.statusCode === 401) {
            // Token 过期 → 跳转登录
            this.handleUnauthorized()
            reject(new Error('登录已过期'))
            return
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data)
          } else {
            reject(res.data)
          }
        },
        fail: reject
      })
    })
  }

  get(url, data) { return this.request({ url, data }) }
  post(url, data) { return this.request({ url, method: 'POST', data }) }
  put(url, data) { return this.request({ url, method: 'PUT', data }) }
  patch(url, data) { return this.request({ url, method: 'PATCH', data }) }
}
```

### 3.3 页面设计详情

#### 📊 仪表盘 (dashboard)

- **统计卡片**：总需求、待审核、开发中、已完成（横向滚动）
- **最近更新列表**：最新8条需求，点击进入详情
- **快速操作**：底部悬浮"提需求"按钮

#### 📋 需求列表 (requirements)

- **顶部筛选栏**：状态选择 + 优先级选择（下拉菜单）
- **搜索**：顶部搜索框（实时搜索）
- **列表项**：卡片式设计，显示标题、优先级标签、状态标签、负责人、截止时间
- **分页**：触底加载更多（上拉加载）
- **右下角悬浮按钮**：提需求

#### 📝 提交需求 (requirement-submit)

- **表单字段**（与Web端一致）：
  - 需求标题（必填，2-120字）
  - 需求描述（必填，多行文本，≥5字）
  - 优先级（picker选择：P0-P3）
  - 业务部门（picker选择）
  - 开发负责人（picker选择，可选）
  - 期望截止时间（date picker）
  - 附件链接（URL输入）
- **提交后跳转**：需求详情页

#### 📄 需求详情 (requirement-detail)

- **顶部**：标题 + 状态标签 + 优先级标签
- **信息区**：提交者、部门、负责人、截止时间、附件
- **描述区**：Markdown渲染（使用 towxml 第三方库）
- **任务列表**：关联任务卡片
- **操作按钮**（根据角色显示）：
  - CTO：通过并分配、拒绝、编辑
  - 提交者（待审核）：编辑
  - 开发者：更新任务状态
- **拒绝弹窗**：输入拒绝原因

#### 📊 开发看板 (kanban) — 移动端适配方案

移动端不适合PC端的多列拖拽看板，改用 **分段Tab + 滑动操作**：

```
┌─────────────────────────────────┐
│  [待审核] [开发中] [测试中] [已完成]  │  ← 顶部Tab切换
├─────────────────────────────────┤
│  ┌─────────────────────────┐   │
│  │ 需求标题                 │   │
│  │ P1 高  ·  开发中  ·  张三 │   │
│  │ 截止: 2026-05-15  →     │   │  ← 右滑显示操作按钮
│  └─────────────────────────┘   │
│  ┌─────────────────────────┐   │
│  │ 另一个需求...            │   │
│  └─────────────────────────┘   │
│                                 │
│           上拉加载更多            │
└─────────────────────────────────┘
```

- **顶部Tab**：待审核 / 开发中 / 测试中 / 已完成
- **卡片列表**：每张卡片显示标题、优先级、状态、负责人
- **左滑操作**（微信常用交互）：显示"查看详情"、"更新状态"等操作按钮
- **CTO专属**：长按卡片可快速分配/审核

---

## 四、API集成

### 4.1 复用现有API

所有接口与Web端完全一致，无需额外开发（除登录接口外）：

| 接口 | 方法 | 说明 | 小程序使用场景 |
|------|------|------|---------------|
| `/api/auth/login` | POST | 邮箱密码登录 | 首次绑定账号 |
| `/api/auth/wechat-login` | POST | 微信登录 | **新增** 小程序静默登录 |
| `/api/auth/wechat-bind` | POST | 绑定微信 | **新增** 首次登录绑定 |
| `/api/requirements` | GET | 需求列表 | 列表页、仪表盘 |
| `/api/requirements` | POST | 提交需求 | 提交页 |
| `/api/requirements/:id` | GET | 需求详情 | 详情页 |
| `/api/requirements/:id` | PATCH | 更新状态 | 审核、分配 |
| `/api/requirements/:id` | PUT | 编辑需求 | 编辑弹窗 |
| `/api/tasks` | GET | 任务列表 | 详情页 |
| `/api/tasks/:id` | PATCH | 更新任务状态 | 详情页 |

### 4.2 后端新增接口（需后端工程师配合）

#### 微信登录接口

```typescript
// POST /api/auth/wechat-login
// Request
{
  code: string  // wx.login() 获取的 code
}
// Response - 已绑定用户
{
  bound: true,
  token: string,
  user: { id, name, email, role }
}
// Response - 未绑定
{
  bound: false,
  sessionKey: string  // 加密的临时标识，用于绑定
}

// POST /api/auth/wechat-bind
// Request
{
  sessionKey: string,  // wechat-login 返回的标识
  email: string,
  password: string
}
// Response
{
  token: string,
  user: { id, name, email, role }
}
```

---

## 五、UI/UX设计

### 5.1 设计规范

- **主色**：`#1677ff`（与Web端一致）
- **字体**：系统默认（微信小程序标准）
- **间距**：基于 8px 网格
- **圆角**：8px（卡片）、4px（按钮）
- **适配**：以 iPhone 6/7/8 (375x667) 为基准，使用 rpx 自适应

### 5.2 页面流程图

```
启动App
  │
  ├── 已登录 → 仪表盘(TabBar首页)
  │     │
  │     ├── [TabBar] 需求列表
  │     │     ├── 搜索/筛选
  │     │     ├── 点击需求 → 需求详情
  │     │     │     ├── [CTO] 通过/拒绝/分配
  │     │     │     ├── [提交者] 编辑
  │     │     │     └── [开发者] 更新任务
  │     │     └── 悬浮按钮 → 提交需求
  │     │
  │     └── [TabBar] 看板
  │           ├── Tab切换状态
  │           └── 左滑操作
  │
  └── 未登录 → 登录页
        ├── 微信一键登录（已绑定直接进）
        └── 绑定已有账号（邮箱+密码）
```

---

## 六、风险与依赖

### 6.1 关键阻塞项

| 风险项 | 影响 | 负责人 | 状态 |
|--------|------|--------|------|
| **域名备案** | 小程序要求服务器域名已备案，否则无法线上使用 | IT运维 (TASK-004) | ⏳ 进行中 |
| **后端微信登录接口** | 小程序登录核心功能 | backend-engineer | ❌ 未开始 |
| **HTTPS证书** | 小程序要求HTTPS | IT运维 | ⏳ 跟随域名备案 |
| **AppID注册** | 需要正确的小程序AppID | 运维/产品 | ❌ 未注册 |

### 6.2 应对策略

1. **域名备案期间** → 使用微信开发者工具的"不校验合法域名"进行本地开发调试
2. **后端接口未就绪** → 先用 Mock 数据开发UI，接口就绪后对接
3. **AppID未注册** → 先用游客模式开发，注册后切换

---

## 七、开发计划

### Phase 1: 基础搭建 (0.5天)
- [ ] 项目初始化（原生小程序项目结构）
- [ ] 网络请求封装（request.js）
- [ ] 常量定义（状态、优先级映射）
- [ ] 全局样式和主题配置
- [ ] TabBar配置和图标资源

### Phase 2: 登录与认证 (0.5天)
- [ ] 登录页面UI
- [ ] 微信登录流程（wx.login → 后端接口）
- [ ] 账号绑定页面
- [ ] Token管理与自动刷新
- [ ] 401拦截和跳转

### Phase 3: 核心页面开发 (2天)
- [ ] 仪表盘页面（统计卡片 + 最近更新）
- [ ] 需求列表页面（搜索、筛选、分页加载）
- [ ] 提交需求页面（表单验证）
- [ ] 需求详情页面（Markdown渲染、操作按钮）
- [ ] 开发看板页面（Tab切换 + 左滑操作）

### Phase 4: API对接与测试 (0.5天)
- [ ] 所有接口对接
- [ ] 角色权限验证
- [ ] 边界情况处理
- [ ] 兼容性测试（iOS/Android）

### Phase 5: 提审 (0.5天)
- [ ] 功能测试
- [ ] 体验优化
- [ ] 提交微信审核

**总预估工时：4个工作日**

---

## 八、验收标准

1. ✅ 微信授权登录可用，首次使用可绑定已有账号
2. ✅ 仪表盘展示统计数据和最近更新
3. ✅ 需求列表支持搜索、状态筛选、分页加载
4. ✅ 可提交新需求（表单完整、验证正确）
5. ✅ 需求详情展示完整，CTO可审核/分配/拒绝
6. ✅ 看板视图支持状态切换和快速操作
7. ✅ 三种角色权限正确区分
8. ✅ 适配主流 iOS/Android 机型
9. ✅ 提交微信审核通过

---

## 九、需要协调的事项

1. **后端工程师** — 新增微信登录接口（`/api/auth/wechat-login`、`/api/auth/wechat-bind`），预计 0.5 天
2. **IT运维** — 域名备案进度直接影响小程序上线时间
3. **产品/CTO** — 确认小程序 AppID 注册（需注册"小程序"类型，非"小游戏"）
4. **设计** — TabBar 图标资源（如有品牌设计规范请同步）
