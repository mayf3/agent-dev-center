// pages/my-requirements/index.js — 我的需求
const request = require('../../utils/request')
const { STATUS_MAP, PRIORITY_MAP } = require('../../utils/constants')
const { formatRelative } = require('../../utils/format')

Page({
  data: {
    requirements: [],
    loading: true,
    statusFilter: '',
    statusLabel: '全部',
    statusOptions: [
      { value: '', label: '全部' },
      { value: 'pending', label: '待审核' },
      { value: 'approved', label: '待开发' },
      { value: 'in-progress', label: '开发中' },
      { value: 'done', label: '已完成' },
      { value: 'rejected', label: '已拒绝' }
    ]
  },

  onLoad() {
    if (!getApp().checkLogin()) return
  },

  onShow() {
    if (!getApp().globalData.token) return
    this.fetchRequirements()
  },

  async fetchRequirements() {
    this.setData({ loading: true })
    try {
      const params = { page: 1, pageSize: 50 }
      if (this.data.statusFilter) params.status = this.data.statusFilter
      const res = await request.get('/requirements', params)
      const list = (res.data || []).map(item => ({
        ...item,
        statusLabel: (STATUS_MAP[item.status] || {}).label || item.status,
        statusColor: (STATUS_MAP[item.status] || {}).color || '',
        priorityLabel: (PRIORITY_MAP[item.priority] || {}).label || item.priority,
        priorityColor: (PRIORITY_MAP[item.priority] || {}).color || '',
        timeAgo: formatRelative(item.updatedAt)
      }))
      this.setData({ requirements: list })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onFilterSelect(e) {
    const value = e.currentTarget.dataset.value
    const label = e.currentTarget.dataset.label
    this.setData({ statusFilter: value, statusLabel: label })
    this.fetchRequirements()
  },

  goToDetail(e) {
    wx.navigateTo({ url: `/pages/requirement-detail/index?id=${e.currentTarget.dataset.id}` })
  }
})
