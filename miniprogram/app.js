// app.js
const request = require('./utils/request')

App({
  globalData: {
    token: '',
    userInfo: null,
    baseUrl: 'http://{your-server-ip}/api'
  },

  onLaunch() {
    // 恢复登录态
    const token = wx.getStorageSync('token')
    const userInfo = wx.getStorageSync('userInfo')
    if (token) {
      this.globalData.token = token
      this.globalData.userInfo = userInfo
      // 启动未读数轮询
      this.startUnreadPolling()
    }
  },

  // 检查登录状态，未登录跳转登录页
  checkLogin() {
    if (!this.globalData.token) {
      wx.navigateTo({ url: '/pages/login/index' })
      return false
    }
    return true
  },

  // 登出
  logout() {
    this.globalData.token = ''
    this.globalData.userInfo = null
    wx.removeStorageSync('token')
    wx.removeStorageSync('userInfo')
    this.stopUnreadPolling()
    wx.reLaunch({ url: '/pages/login/index' })
  },

  // ============ 未读通知轮询 ============
  _unreadTimer: null,

  startUnreadPolling() {
    this.stopUnreadPolling()
    this._fetchUnreadCount()
    // 每 30 秒检查一次未读数量
    this._unreadTimer = setInterval(() => {
      this._fetchUnreadCount()
    }, 30000)
  },

  stopUnreadPolling() {
    if (this._unreadTimer) {
      clearInterval(this._unreadTimer)
      this._unreadTimer = null
    }
  },

  async _fetchUnreadCount() {
    if (!this.globalData.token) return
    try {
      const res = await request.get('/notifications/unread-count')
      const count = res.unreadCount || 0
      if (count > 0) {
        wx.setTabBarBadge({
          index: 2,
          text: count > 99 ? '99+' : String(count)
        })
      } else {
        wx.removeTabBarBadge({ index: 2 })
      }
    } catch {
      // 静默忽略错误
    }
  }
})
