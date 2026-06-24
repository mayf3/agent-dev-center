// pages/requirements/index.js — 需求列表（TabBar首页）
const request = require('../../utils/request')
const { STATUS_MAP, PRIORITY_MAP, ROLE_MAP } = require('../../utils/constants')
const { formatRelative } = require('../../utils/format')
const app = getApp()

Page({
  data: {
    requirements: [],
    loading: true,
    refreshing: false,
    page: 1,
    pageSize: 10,
    hasMore: true,
    // 筛选
    statusFilter: '',
    priorityFilter: '',
    showStatusFilter: false,
    showPriorityFilter: false,
    // 用户信息
    userRole: '',
    // 状态选项
    statusOptions: [
      { value: '', label: '全部状态' },
      { value: 'pending', label: '待审核' },
      { value: 'approved', label: '待开发' },
      { value: 'in-progress', label: '开发中' },
      { value: 'testing', label: '测试中' },
      { value: 'review', label: '待验收' },
      { value: 'done', label: '已完成' },
      { value: 'rejected', label: '已拒绝' }
    ],
    priorityOptions: [
      { value: '', label: '全部优先级' },
      { value: 'P0', label: 'P0 紧急' },
      { value: 'P1', label: 'P1 高' },
      { value: 'P2', label: 'P2 中' },
      { value: 'P3', label: 'P3 低' }
    ]
  },

  onLoad() {
    if (!app.checkLogin()) return
    const userInfo = app.globalData.userInfo
    const userRole = userInfo ? userInfo.role : ''
    this.setData({
      userInfo: userInfo || {},
      userRole,
      roleLabels: ROLE_MAP
    })
  },

  onShow() {
    if (!app.globalData.token) return
    this.setData({ page: 1, requirements: [], hasMore: true })
    this.fetchRequirements()
  },

  onPullDownRefresh() {
    this.setData({ page: 1, refreshing: true, hasMore: true })
    this.fetchRequirements().then(() => {
      wx.stopPullDownRefresh()
      this.setData({ refreshing: false })
    })
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.fetchRequirements()
    }
  },

  async fetchRequirements() {
    if (this.data.loading && this.data.page > 1) return
    this.setData({ loading: true })

    try {
      const params = {
        page: this.data.page,
        pageSize: this.data.pageSize
      }
      if (this.data.statusFilter) params.status = this.data.statusFilter
      if (this.data.priorityFilter) params.priority = this.data.priorityFilter

      const res = await request.get('/requirements', params)
      const list = (res.data || []).map(item => ({
        ...item,
        statusLabel: (STATUS_MAP[item.status] || {}).label || item.status,
        statusColor: (STATUS_MAP[item.status] || {}).color || '',
        priorityLabel: (PRIORITY_MAP[item.priority] || {}).label || item.priority,
        priorityColor: (PRIORITY_MAP[item.priority] || {}).color || '',
        timeAgo: formatRelative(item.updatedAt)
      }))

      const newList = this.data.page === 1 ? list : [...this.data.requirements, ...list]
      this.setData({
        requirements: newList,
        hasMore: list.length >= this.data.pageSize,
        page: this.data.page + 1,
        loading: false
      })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  // 筛选操作
  toggleStatusFilter() {
    this.setData({ showStatusFilter: !this.data.showStatusFilter, showPriorityFilter: false })
  },
  togglePriorityFilter() {
    this.setData({ showPriorityFilter: !this.data.showPriorityFilter, showStatusFilter: false })
  },
  onStatusSelect(e) {
    const value = e.currentTarget.dataset.value
    const label = value ? (STATUS_MAP[value] || {}).label || value : '全部状态'
    this.setData({ statusFilter: value, statusLabel: label, showStatusFilter: false, page: 1, requirements: [], hasMore: true })
    this.fetchRequirements()
  },
  onPrioritySelect(e) {
    const value = e.currentTarget.dataset.value
    const label = value ? (PRIORITY_MAP[value] || {}).label || value : '全部优先级'
    this.setData({ priorityFilter: value, priorityLabel: label, showPriorityFilter: false, page: 1, requirements: [], hasMore: true })
    this.fetchRequirements()
  },
  closeFilter() {
    this.setData({ showStatusFilter: false, showPriorityFilter: false })
  },

  // 导航
  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/requirement-detail/index?id=${id}` })
  },
  goToSubmit() {
    wx.navigateTo({ url: '/pages/requirement-submit/index' })
  },
  goToMyRequirements() {
    wx.navigateTo({ url: '/pages/my-requirements/index' })
  },
  goToMyTasks() {
    wx.switchTab({ url: '/pages/my-tasks/index' })
  },
  goToReports() {
    wx.navigateTo({ url: '/pages/reports/index' })
  },
  handleLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) app.logout()
      }
    })
  }
})
