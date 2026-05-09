# Agent开发中心 - Android APP 技术方案

> 编写：mobile-app-engineer | 日期：2026-05-09 | 状态：评审中

---

## 一、需求理解

### 1.1 产品定位

将 Web 端「Agent开发中心」（需求驱动开发管理平台）的核心功能移植到 Android 原生应用，让 CTO 和开发 Agent 能在移动端完成需求管理、审核、看板操作。

### 1.2 核心功能清单

| 模块 | 功能 | 优先级 | 说明 |
|------|------|--------|------|
| **认证** | 登录/注册 | P0 | 邮箱+密码，JWT 鉴权 |
| **仪表盘** | 数据概览 | P1 | 统计卡片 + 最近需求列表 |
| **需求列表** | 筛选/搜索/分页 | P0 | 按状态、优先级、关键词筛选 |
| **需求详情** | 查看/编辑/审核 | P0 | Markdown 描述、任务列表、状态操作 |
| **提交需求** | 表单提交 | P0 | 标题/描述/优先级/部门/负责人/截止日期 |
| **开发看板** | 四列拖拽 | P0 | 待审核/开发中/测试中/已完成 |
| **个人中心** | 用户信息/退出 | P1 | 角色显示、登出 |

### 1.3 用户角色与权限

| 角色 | 能力 |
|------|------|
| **CTO (admin)** | 全部权限：审核/分配/拒绝需求，查看所有数据 |
| **需求提交者 (requester)** | 提需求、编辑自己的待审核需求、查看进度 |
| **开发Agent (developer)** | 查看分配给自己的任务、更新任务状态 |

### 1.4 业务流程

```
提交需求 → 待审核 → [审核通过 → 分配Agent → 开发中 → 测试中 → 待验收 → 已完成]
                   → [审核拒绝 → 编辑 → 重新提交]
```

---

## 二、技术方案设计

### 2.1 技术栈选型

> **重要变更**：原计划使用 Kotlin + Jetpack Compose，但考虑到：
> 1. 当前机器没有安装 Android Studio 和 JDK
> 2. 安装和配置 Kotlin/Android 开发环境需要较长时间
> 3. 我已有 React Native / Expo 开发经验（计数器项目已完成）
> 4. 后端 API 已经完备，前端逻辑可复用
>
> **最终选择 React Native + Expo**，原因：
> - 开发效率高，可复用 Web 端的 API 类型定义和业务逻辑
> - Expo 构建 APK 方便，支持 EAS Build 云端构建
> - 一套代码可同时覆盖 Android（未来也可扩展 iOS）
> - 环境已验证（计数器项目已跑通完整流程）

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| **框架** | React Native + Expo SDK 54 | 跨平台、开发效率高 |
| **语言** | TypeScript | 类型安全，与后端一致 |
| **状态管理** | React Context + useState | MVP 阶段足够 |
| **导航** | React Navigation 6 | 底部 Tab + Stack 导航 |
| **UI组件** | React Native Paper | Material Design 3 风格 |
| **网络请求** | Axios | 与 Web 端一致的 HTTP 客户端 |
| **本地存储** | AsyncStorage | Token 持久化 |
| **Markdown渲染** | react-native-markdown-display | 需求描述展示 |
| **看板拖拽** | react-native-reanimated + Gesture Handler | 流畅的拖拽交互 |
| **构建工具** | EAS Build | 云端构建 APK |
| **包管理** | npm | 与项目一致 |

### 2.2 架构设计

```
┌─────────────────────────────────────────┐
│                  App                     │
├─────────────────────────────────────────┤
│  Navigation (React Navigation 6)        │
│  ┌────────┐ ┌─────────┐ ┌───────────┐  │
│  │  Auth  │ │  Main   │ │  Profile  │  │
│  │ Stack  │ │  Tabs   │ │  Stack    │  │
│  └────────┘ └─────────┘ └───────────┘  │
├─────────────────────────────────────────┤
│              Screens/Pages              │
│  Login | Register | Dashboard |         │
│  ReqList | ReqDetail | Submit |         │
│  Kanban | Profile                       │
├─────────────────────────────────────────┤
│           API Layer (Axios)             │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │   Auth   │ │   Req    │ │  Task   │ │
│  │  Client  │ │  Client  │ │ Client  │ │
│  └──────────┘ └──────────┘ └─────────┘ │
├─────────────────────────────────────────┤
│         Types & Constants               │
│  (与 Web 端共用类型定义)                  │
├─────────────────────────────────────────┤
│     Auth Context (Token + User)         │
│     AsyncStorage 持久化                  │
└─────────────────────────────────────────┘
```

### 2.3 数据模型（与 Web 端一致）

```typescript
// 用户角色
type UserRole = 'admin' | 'requester' | 'developer';

// 需求优先级
type RequirementPriority = 'P0' | 'P1' | 'P2' | '3';

// 需求状态
type RequirementStatus =
  | 'pending' | 'approved' | 'rejected'
  | 'in-progress' | 'testing' | 'review' | 'done';

// 任务状态
type TaskStatus = 'todo' | 'in-progress' | 'done';

// 需求实体
interface Requirement {
  id: string;
  title: string;
  description: string;       // Markdown
  priority: RequirementPriority;
  status: RequirementStatus;
  requester: string;
  department: string;
  assignee?: string | null;
  dueDate?: string | null;
  attachment?: string | null;
  rejectReason?: string | null;
  createdAt: string;
  updatedAt: string;
  tasks?: Task[];
}

// 任务实体
interface Task {
  id: string;
  requirementId: string;
  title: string;
  description: string;
  agentType: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

// 用户实体
interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

// 分页响应
interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
```

---

## 三、API 集成方案

### 3.1 后端 API 接口清单

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | /api/auth/login | 登录 | 公开 |
| POST | /api/auth/register | 注册 | 公开 |
| GET | /api/requirements | 需求列表（分页/筛选） | 登录 |
| POST | /api/requirements | 提交需求 | 登录 |
| GET | /api/requirements/:id | 需求详情 | 登录 |
| PUT | /api/requirements/:id | 编辑需求 | 提交者/管理员 |
| PATCH | /api/requirements/:id | 更新状态/分配 | 管理员/开发者 |
| GET | /api/tasks | 任务列表 | 登录 |
| POST | /api/tasks | 创建任务 | 管理员/开发者 |
| PATCH | /api/tasks/:id | 更新任务状态 | 管理员/开发者 |

### 3.2 API Client 设计

```typescript
// api/client.ts - 与 Web 端一致的 Axios 配置
const api = axios.create({
  baseURL: API_BASE_URL,  // 可配置，默认 http://8.163.44.127/api
  timeout: 15000
});

// 请求拦截器 - 自动附加 Token
api.interceptors.request.use((config) => {
  const token = await AsyncStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器 - 401 自动跳转登录
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // 清除本地存储，跳转登录页
    }
    return Promise.reject(error);
  }
);
```

### 3.3 错误处理策略

| 错误类型 | 处理方式 |
|----------|----------|
| 网络错误 | Toast 提示"网络连接失败，请检查网络" |
| 401 未授权 | 清除 Token，跳转登录页 |
| 403 无权限 | Toast 提示"您没有权限执行此操作" |
| 404 不存在 | 提示"数据不存在"，返回列表 |
| 500 服务器错误 | Toast 提示"服务器异常，请稍后重试" |

---

## 四、UI/UX 设计

### 4.1 页面结构

```
┌──────────────────────────┐
│     React Navigation     │
│  ┌────────────────────┐  │
│  │   Auth Stack       │  │
│  │   ├── LoginScreen  │  │
│  │   └── RegisterScr  │  │
│  └────────────────────┘  │
│  ┌────────────────────┐  │
│  │   Main Tabs        │  │
│  │   ├── 首页(Dash)   │  │
│  │   ├── 需求(List)   │  │
│  │   ├── 看板(Kanban) │  │
│  │   └── 我的(Profile)│  │
│  └────────────────────┘  │
│  ┌────────────────────┐  │
│  │   Detail Stack     │  │
│  │   ├── ReqDetail    │  │
│  │   ├── SubmitReq    │  │
│  │   └── EditReq      │  │
│  └────────────────────┘  │
└──────────────────────────┘
```

### 4.2 各页面设计要点

#### 登录/注册页
- 顶部 Logo + 应用名称
- 登录 Tab / 注册 Tab 切换
- 登录：邮箱 + 密码
- 注册：姓名 + 邮箱 + 密码 + 角色选择
- Material Design 3 输入框风格

#### 仪表盘（首页）
- 4个统计卡片（总需求/待审核/开发中/已完成）
- 最近更新列表（最近8条需求）
- 下拉刷新

#### 需求列表
- 顶部筛选栏（搜索框 + 状态筛选 + 优先级筛选）
- 列表项：标题 + 优先级标签 + 状态标签 + 负责人
- 分页加载（上拉加载更多）
- 右下角 FAB 按钮：提交新需求

#### 需求详情
- 顶部：返回按钮 + 优先级/状态标签
- 操作按钮区（根据角色显示）：
  - CTO：通过并分配 / 分配Agent / 拒绝
  - 提交者：编辑（仅待审核/已拒绝状态）
- 需求描述（Markdown 渲染）
- 需求信息卡片（提交者、部门、负责人、截止日期等）
- 关联任务列表（开发者可更新任务状态）

#### 提交需求
- 表单：标题、描述（多行）、优先级、部门、负责人、截止日期、附件链接
- 表单验证与 Web 端一致

#### 开发看板
- 横向滚动的4列看板（待审核 / 开发中 / 测试中 / 已完成）
- 卡片：标题 + 优先级 + 状态 + 负责人
- 长按拖拽修改状态（CTO和开发者）
- 下拉刷新

#### 个人中心
- 用户头像/名称
- 角色标签
- 退出登录按钮
- 应用版本信息

### 4.3 主题配色（与 Web 端一致）

| 元素 | 颜色 | 说明 |
|------|------|------|
| 主色 | #1677FF | 蓝色，与 Web 端一致 |
| 背景 | #F5F7FB | 浅灰背景 |
| 卡片 | #FFFFFF | 白色卡片 |
| P0 | Red | 紧急 |
| P1 | Volcano | 高 |
| P2 | Gold | 中 |
| P3 | Green | 低 |

---

## 五、项目结构

```
agent-dev-center-android/
├── App.tsx                         # 入口，导航配置
├── app.json                        # Expo 配置
├── eas.json                        # EAS Build 配置
├── package.json
├── tsconfig.json
│
├── src/
│   ├── api/
│   │   ├── client.ts               # Axios 实例 + 拦截器
│   │   ├── auth.ts                  # 登录/注册 API
│   │   ├── requirements.ts          # 需求 CRUD API
│   │   ├── tasks.ts                 # 任务 API
│   │   └── types.ts                 # 类型定义
│   │
│   ├── contexts/
│   │   └── AuthContext.tsx          # 认证上下文
│   │
│   ├── constants/
│   │   └── options.ts              # 常量（与 Web 端一致）
│   │
│   ├── components/
│   │   ├── StatusTag.tsx            # 需求状态标签
│   │   ├── PriorityTag.tsx          # 优先级标签
│   │   ├── TaskStatusTag.tsx        # 任务状态标签
│   │   ├── ProtectedRoute.tsx       # 路由守卫
│   │   ├── AppLayout.tsx            # 底部 Tab 布局
│   │   └── KanbanCard.tsx           # 看板卡片
│   │
│   ├── screens/
│   │   ├── LoginScreen.tsx          # 登录
│   │   ├── RegisterScreen.tsx       # 注册
│   │   ├── DashboardScreen.tsx      # 仪表盘
│   │   ├── RequirementListScreen.tsx # 需求列表
│   │   ├── RequirementDetailScreen.tsx # 需求详情
│   │   ├── SubmitRequirementScreen.tsx # 提交需求
│   │   ├── KanbanBoardScreen.tsx    # 开发看板
│   │   └── ProfileScreen.tsx        # 个人中心
│   │
│   ├── navigation/
│   │   ├── AuthStack.tsx            # 认证导航栈
│   │   ├── MainTabs.tsx             # 主 Tab 导航
│   │   └── RootNavigator.tsx        # 根导航
│   │
│   └── utils/
│       ├── storage.ts               # AsyncStorage 封装
│       └── format.ts                # 日期格式化等工具
│
└── assets/
    ├── icon.png                     # 应用图标
    ├── splash-icon.png              # 启动画面
    └── adaptive-icon.png            # Android 自适应图标
```

---

## 六、开发计划

### Phase 1：项目搭建（Day 1）

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 初始化 Expo 项目 | 1h | 项目脚手架 |
| 配置依赖（导航、UI库、Axios等） | 1h | package.json |
| 搭建导航结构 | 1h | 导航框架 |
| 实现 API Client + Auth Context | 1h | 基础设施 |
| **小计** | **4h** | |

### Phase 2：核心功能开发（Day 2-4）

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 登录/注册页面 | 3h | LoginScreen + RegisterScreen |
| 仪表盘页面 | 3h | DashboardScreen |
| 需求列表 + 筛选 | 4h | RequirementListScreen |
| 需求详情 + 操作 | 5h | RequirementDetailScreen |
| 提交需求表单 | 3h | SubmitRequirementScreen |
| 开发看板 | 6h | KanbanBoardScreen |
| 个人中心 | 1h | ProfileScreen |
| **小计** | **25h (3.5d)** | |

### Phase 3：集成测试与优化（Day 5）

| 任务 | 工时 | 交付物 |
|------|------|--------|
| API 集成联调 | 3h | 全功能可用 |
| 边界情况处理 | 2h | 错误处理完善 |
| 性能优化 | 1h | 流畅度优化 |
| 构建测试 APK | 1h | APK 安装包 |
| **小计** | **7h (1d)** | |

### 总工时：5 个工作日

---

## 七、测试策略

### 7.1 测试类型

| 类型 | 范围 | 工具 |
|------|------|------|
| 单元测试 | 工具函数、API Client | Jest |
| 组件测试 | 各 Screen 渲染 | React Testing Library |
| 集成测试 | 完整业务流程 | 手动 + E2E |
| 兼容性测试 | 不同 Android 版本 | 模拟器 + 真机 |

### 7.2 关键测试用例

1. **登录流程**：注册 → 登录 → Token 保存 → 自动登录
2. **需求管理**：提交 → 列表查看 → 筛选 → 详情 → 状态变更
3. **看板操作**：查看 → 拖拽状态变更 → 刷新
4. **权限控制**：不同角色看到不同操作按钮
5. **离线处理**：网络断开时的错误提示
6. **Token 过期**：401 自动跳转登录

---

## 八、发布方案

### 8.1 构建

```bash
# 开发版 APK（EAS Build 云端构建）
eas build --platform android --profile preview

# 生产版 AAB
eas build --platform android --profile production
```

### 8.2 分发

| 方式 | 说明 |
|------|------|
| EAS Build 链接 | 构建完成后生成 HTTPS 下载链接 |
| 内部分发 | 通过飞书群/邮件发送下载链接 |
| Google Play | 后续可上传到应用商店 |

---

## 九、风险与应对

| 风险 | 影响 | 应对方案 |
|------|------|----------|
| 后端 API 未部署完成 | 阻塞联调 | 先用 Mock 数据开发，API 就绪后切换 |
| 域名未确定 | API 地址变更 | 配置文件统一管理 baseURL |
| 安全审查未通过 | API 安全性风险 | HTTPS + JWT + 输入校验 |
| 看板拖拽性能 | 用户体验 | 使用 Reanimated 优化动画 |
| Expo Go 兼容性 | 测试限制 | 直接构建 APK 测试 |

---

## 十、与 Web 端对比

| 功能 | Web 端 | Android 端 | 差异 |
|------|--------|------------|------|
| 认证 | localStorage | AsyncStorage | 存储方式不同 |
| UI框架 | Ant Design | React Native Paper | 原生体验 |
| 看板拖拽 | @dnd-kit | Reanimated + Gesture | 手势实现不同 |
| 路由 | React Router | React Navigation | 原生导航 |
| 列表 | Ant Table | FlatList | 虚拟滚动 |
| Markdown | react-markdown | react-native-markdown-display | 渲染引擎不同 |
| 布局 | 侧边栏 | 底部 Tab | 移动端适配 |

---

**文档版本**：v1.0
**编写日期**：2026-05-09
**编写人**：mobile-app-engineer
**审核人**：待 CTO 审核
