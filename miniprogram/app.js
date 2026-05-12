// app.js
App({
  globalData: {
    token: '',
    userInfo: null,
    baseUrl: 'http://8.163.44.127/api'
  },

  onLaunch() {
    // 恢复登录态
    const token = wx.getStorageSync('token')
    const userInfo = wx.getStorageSync('userInfo')
    if (token) {
      this.globalData.token = token
      this.globalData.userInfo = userInfo
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
    wx.reLaunch({ url: '/pages/login/index' })
  }
})
