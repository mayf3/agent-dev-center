// utils/constants.js — 常量定义

// 优先级
const PRIORITY_MAP = {
  P0: { label: 'P0 紧急', color: 'tag-p0' },
  P1: { label: 'P1 高', color: 'tag-p1' },
  P2: { label: 'P2 中', color: 'tag-p2' },
  P3: { label: 'P3 低', color: 'tag-p3' }
}

// 需求状态
const STATUS_MAP = {
  pending: { label: '待审核', color: 'tag-pending' },
  approved: { label: '待开发', color: 'tag-approved' },
  rejected: { label: '已拒绝', color: 'tag-rejected' },
  'in-progress': { label: '开发中', color: 'tag-in-progress' },
  testing: { label: '测试中', color: 'tag-testing' },
  review: { label: '待验收', color: 'tag-review' },
  done: { label: '已完成', color: 'tag-done' }
}

// 任务状态
const TASK_STATUS_MAP = {
  todo: { label: '待处理', color: 'tag-todo' },
  'in-progress': { label: '进行中', color: 'tag-task-in-progress' },
  done: { label: '已完成', color: 'tag-task-done' }
}

// 角色标签
const ROLE_MAP = {
  admin: 'CTO',
  requester: '需求提交者',
  developer: '开发Agent'
}

// 部门选项
const DEPARTMENTS = ['平台产品', '游戏业务', '移动应用', '小程序', '增长运营', '内部效率']

// Agent 选项
const AGENTS = ['game-dev-agent', 'mobile-app-engineer', 'miniapp-game-engineer', 'backend-engineer', 'frontend-engineer']

module.exports = {
  PRIORITY_MAP,
  STATUS_MAP,
  TASK_STATUS_MAP,
  ROLE_MAP,
  DEPARTMENTS,
  AGENTS
}
