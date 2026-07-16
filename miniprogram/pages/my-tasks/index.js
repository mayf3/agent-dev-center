// pages/my-tasks/index.js — 我的任务（TabBar）
const request = require('../../utils/request')
const { TASK_STATUS_MAP, PRIORITY_MAP, STATUS_MAP } = require('../../utils/constants')
const { formatRelative } = require('../../utils/format')

Page({
  data: {
    tasks: [],
    loading: true,
    userRole: ''
  },

  onLoad() {
    if (!getApp().checkLogin()) return
    this.setData({ userRole: (getApp().globalData.userInfo || {}).role || '' })
  },

  onShow() {
    if (!getApp().globalData.token) return
    this.fetchTasks()
  },

  async fetchTasks() {
    this.setData({ loading: true })
    try {
      const res = await request.get('/tasks', { pageSize: 50 })
      const tasks = (res.data || []).map(t => ({
        ...t,
        statusLabel: (TASK_STATUS_MAP[t.status] || {}).label || t.status,
        statusColor: (TASK_STATUS_MAP[t.status] || {}).color || '',
        timeAgo: formatRelative(t.updatedAt),
        priorityLabel: (PRIORITY_MAP[(t.requirement || {}).priority] || {}).label || '',
        priorityColor: (PRIORITY_MAP[(t.requirement || {}).priority] || {}).color || '',
        reqStatusLabel: (STATUS_MAP[(t.requirement || {}).status] || {}).label || ''
      }))
      this.setData({ tasks })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async updateTaskStatus(e) {
    const { id } = e.currentTarget.dataset
    wx.showActionSheet({
      itemList: ['待处理', '进行中', '已完成'],
      success: async (res) => {
        const statusMap = ['todo', 'in-progress', 'done']
        try {
          await request.patch(`/tasks/${id}`, { status: statusMap[res.tapIndex] })
          wx.showToast({ title: '已更新', icon: 'success' })
          this.fetchTasks()
        } catch (err) {
          wx.showToast({ title: err.message || '更新失败', icon: 'none' })
        }
      }
    })
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.rid
    wx.navigateTo({ url: `/pages/requirement-detail/index?id=${id}` })
  }
})
