// pages/notifications/index.js — 通知列表
const request = require('../../utils/request')
const { formatRelative } = require('../../utils/format')

// 通知类型 → 中文标签
const TYPE_LABELS = {
  'requirement.submitted': '需求提交',
  'requirement.updated': '需求更新',
  'requirement.status_changed': '状态变更',
  'requirement.comment_added': '新评论',
  'task.created': '任务创建',
  'task.status_changed': '任务状态',
  'task.assigned': '任务分配',
  'task.deleted': '任务删除',
  'report.submitted': '报告提交',
  'report.approved': '报告通过',
  'report.rejected': '报告驳回',
  'requirement.decomposed': '需求拆解',
}

// 通知类型 → CSS class（替换点号为下划线）
const TYPE_CLASS_MAP = {
  'requirement.submitted': 'requirement_submitted',
  'requirement.updated': 'requirement_updated',
  'requirement.status_changed': 'requirement_status_changed',
  'requirement.comment_added': 'requirement_comment_added',
  'task.created': 'task_created',
  'task.status_changed': 'task_status_changed',
  'task.assigned': 'task_assigned',
  'report.submitted': 'report_submitted',
  'report.approved': 'report_approved',
  'report.rejected': 'report_rejected',
  'requirement.decomposed': 'requirement_decomposed',
}

Page({
  data: {
    notifications: [],
    unreadCount: 0,
    loading: true,
    page: 1,
    hasMore: true,
  },

  onLoad() {
    if (!getApp().checkLogin()) return
  },

  onShow() {
    if (!getApp().globalData.token) return
    this.setData({ page: 1, notifications: [], hasMore: true })
    this.fetchNotifications()
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.setData({ page: 1, notifications: [], hasMore: true })
    this.fetchNotifications().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  // 上拉加载更多
  onReachBottom() {
    if (this.data.loading || !this.data.hasMore) return
    this.setData({ page: this.data.page + 1 })
    this.fetchNotifications(true)
  },

  async fetchNotifications(append = false) {
    this.setData({ loading: true })
    try {
      const res = await request.get('/notifications', {
        page: this.data.page,
        limit: 20,
      })

      // 标准化通知数据
      const items = (res.items || []).map(item => {
        const typeKey = (item.type || '').replace(/\./g, '_')
        return {
          ...item,
          typeLabel: TYPE_LABELS[item.type] || item.type,
          typeClass: TYPE_CLASS_MAP[item.type] || typeKey,
          timeAgo: formatRelative(item.createdAt),
          hasSummary: !!(item.content && item.content.summary),
          summaryText: (item.content && item.content.summary) || '',
        }
      })

      this.setData({
        notifications: append ? [...this.data.notifications, ...items] : items,
        unreadCount: res.unreadCount || 0,
        hasMore: items.length >= 20,
        loading: false,
      })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  // 标记单条已读
  async markRead(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return

    try {
      await request.patch(`/notifications/${id}`)
      // 更新本地状态
      const list = this.data.notifications.map(item => {
        if (item.id === id) item.isRead = true
        return item
      })
      this.setData({
        notifications: list,
        unreadCount: Math.max(0, this.data.unreadCount - 1),
      })
      // 更新 TabBar badge
      this.updateBadge()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  // 全部已读
  async markAllRead() {
    try {
      await request.post('/notifications/read-all')
      const list = this.data.notifications.map(item => ({ ...item, isRead: true }))
      this.setData({
        notifications: list,
        unreadCount: 0,
      })
      wx.showToast({ title: '已全部标为已读', icon: 'none' })
      this.updateBadge()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  // 点击通知 → 跳转相关需求/任务
  onTapNotification(e) {
    const id = e.currentTarget.dataset.id
    const relatedReqId = e.currentTarget.dataset.related

    // 如果有关联需求，跳转到需求详情
    if (relatedReqId) {
      wx.navigateTo({
        url: `/pages/requirement-detail/index?id=${relatedReqId}`
      })
    }

    // 点击时标记已读
    if (!this.data.notifications.find(n => n.id === id)?.isRead) {
      request.patch(`/notifications/${id}`).catch(() => {})
      const list = this.data.notifications.map(item => {
        if (item.id === id) item.isRead = true
        return item
      })
      this.setData({
        notifications: list,
        unreadCount: Math.max(0, this.data.unreadCount - 1),
      })
      this.updateBadge()
    }
  },

  // 更新 TabBar 角标
  updateBadge() {
    const count = this.data.unreadCount
    if (count > 0) {
      wx.setTabBarBadge({
        index: 2, // 通知 Tab 在第3个位置（0=需求, 1=我的任务, 2=通知）
        text: count > 99 ? '99+' : String(count)
      })
    } else {
      wx.removeTabBarBadge({ index: 2 })
    }
  },
})
