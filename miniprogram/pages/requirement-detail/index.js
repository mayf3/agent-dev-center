// pages/requirement-detail/index.js — 需求详情
const request = require('../../utils/request')
const { STATUS_MAP, PRIORITY_MAP, TASK_STATUS_MAP, AGENTS } = require('../../utils/constants')
const { formatDateTime } = require('../../utils/format')
const { formatDateTime } = require('../../utils/format')

Page({
  data: {
    requirement: null,
    loading: true,
    tasks: [],
    userRole: '',
    reports: [],
    showRejectModal: false,
    rejectReason: '',
    actionLoading: false,
    // 分配弹窗
    showAssignModal: false,
    assignAgent: '',
    // 状态映射
    statusMap: {},
    priorityMap: {},
    taskStatusMap: {}
  },

  onLoad(options) {
    this.setData({
      statusMap: STATUS_MAP,
      priorityMap: PRIORITY_MAP,
      taskStatusMap: TASK_STATUS_MAP,
      userRole: (getApp().globalData.userInfo || {}).role || '',
      agents: AGENTS
    })
    if (options.id) {
      this.setData({ id: options.id })
      this.fetchDetail(options.id)
      this.fetchReports(options.id)
    }
  },

  async fetchDetail(id) {
    this.setData({ loading: true })
    try {
      const data = await request.get(`/requirements/${id}`)
      const req = {
        ...data,
        statusLabel: (STATUS_MAP[data.status] || {}).label || data.status,
        statusColor: (STATUS_MAP[data.status] || {}).color || '',
        priorityLabel: (PRIORITY_MAP[data.priority] || {}).label || data.priority,
        priorityColor: (PRIORITY_MAP[data.priority] || {}).color || '',
        createdAt: formatDateTime(data.createdAt),
        updatedAt: formatDateTime(data.updatedAt),
        dueDateVal: data.dueDate ? formatDateTime(data.dueDate) : '未设置'
      }
      const tasks = (data.tasks || []).map(t => ({
        ...t,
        statusLabel: (TASK_STATUS_MAP[t.status] || {}).label || t.status,
        statusColor: (TASK_STATUS_MAP[t.status] || {}).color || '',
        updatedAt: formatDateTime(t.updatedAt)
      }))
      this.setData({ requirement: req, tasks })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async fetchReports(id) {
    try {
      const data = await request.get(`/requirements/${id}/reports`)
      const reports = (data.data || data || []).map(r => ({
        ...r,
        createdAt: formatDateTime(r.createdAt || r.updatedAt)
      }))
      this.setData({ reports })
    } catch (_) { /* ignore */ }
  },

  // 审核操作
  async handleApprove() {
    if (!this.data.requirement) return
    this.setData({ actionLoading: true })
    try {
      await request.patch(`/requirements/${this.data.requirement.id}`, { status: 'approved' })
      wx.showToast({ title: '已通过', icon: 'success' })
      this.fetchDetail(this.data.requirement.id)
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ actionLoading: false })
    }
  },

  openReject() {
    this.setData({ showRejectModal: true, rejectReason: '' })
  },
  onRejectInput(e) {
    this.setData({ rejectReason: e.detail.value })
  },
  async handleReject() {
    const { requirement, rejectReason } = this.data
    if (!rejectReason.trim()) {
      wx.showToast({ title: '请输入拒绝原因', icon: 'none' })
      return
    }
    this.setData({ actionLoading: true })
    try {
      await request.patch(`/requirements/${requirement.id}`, { status: 'rejected', rejectReason: rejectReason.trim() })
      wx.showToast({ title: '已拒绝', icon: 'success' })
      this.setData({ showRejectModal: false })
      this.fetchDetail(requirement.id)
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ actionLoading: false })
    }
  },
  closeModal() {
    this.setData({ showRejectModal: false, showAssignModal: false })
  },

  // 分配
  openAssign() {
    this.setData({ showAssignModal: true, assignAgent: '' })
  },
  onAgentSelect(e) {
    this.setData({ assignAgent: e.detail.value })
  },
  async handleAssign() {
    const { requirement, assignAgent } = this.data
    if (!assignAgent) {
      wx.showToast({ title: '请选择开发Agent', icon: 'none' })
      return
    }
    this.setData({ actionLoading: true })
    try {
      await request.patch(`/requirements/${requirement.id}`, { status: 'approved', assignee: assignAgent })
      wx.showToast({ title: '已分配', icon: 'success' })
      this.setData({ showAssignModal: false })
      this.fetchDetail(requirement.id)
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ actionLoading: false })
    }
  },

  // 任务状态更新
  async updateTaskStatus(e) {
    const { id, status } = e.currentTarget.dataset
    wx.showActionSheet({
      itemList: ['待处理', '进行中', '已完成'],
      success: async (res) => {
        const statusMap = ['todo', 'in-progress', 'done']
        const newStatus = statusMap[res.tapIndex]
        try {
          await request.patch(`/tasks/${id}`, { status: newStatus })
          wx.showToast({ title: '状态已更新', icon: 'success' })
          this.fetchDetail(this.data.requirement.id)
          this.fetchReports(this.data.requirement.id)
        } catch (err) {
          wx.showToast({ title: err.message || '更新失败', icon: 'none' })
        }
      }
    })
  },

  goBack() { wx.navigateBack() }
})
