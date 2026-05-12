// pages/reports/index.js — 验收报告列表
const request = require('../../utils/request')
const { formatDateTime } = require('../../utils/format')

Page({
  data: {
    reports: [],
    loading: true
  },

  onLoad() {
    if (!getApp().checkLogin()) return
    this.fetchReports()
  },

  onShow() {
    if (!getApp().globalData.token) return
    this.fetchReports()
  },

  async fetchReports() {
    this.setData({ loading: true })
    try {
      // Get requirements with done status, then fetch their reports
      const res = await request.get('/requirements', { page: 1, pageSize: 50, status: 'done' })
      const doneReq = res.data || []

      const allReports = []
      for (const req of doneReq) {
        try {
          const reportData = await request.get(`/requirements/${req.id}/reports`)
          const reports = reportData.data || reportData || []
          reports.forEach(r => {
            allReports.push({
              ...r,
              requirementTitle: req.title,
              requirementId: req.id,
              createdAt: formatDateTime(r.createdAt || r.updatedAt)
            })
          })
        } catch (_) { /* skip requirements without reports */ }
      }

      this.setData({ reports: allReports })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  goToDetail(e) {
    const rid = e.currentTarget.dataset.rid
    wx.navigateTo({ url: `/pages/requirement-detail/index?id=${rid}` })
  }
})
