// pages/login/index.js
const request = require('../../utils/request')
const app = getApp()

Page({
  data: {
    email: '',
    password: '',
    loading: false,
    errorMsg: ''
  },

  onLoad() {
    // 如果已登录，直接跳转
    if (app.globalData.token) {
      wx.reLaunch({ url: '/pages/requirements/index' })
    }
  },

  onEmailInput(e) {
    this.setData({ email: e.detail.value, errorMsg: '' })
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value, errorMsg: '' })
  },

  async handleLogin() {
    const { email, password } = this.data

    if (!email.trim()) {
      this.setData({ errorMsg: '请输入邮箱' })
      return
    }
    if (!password.trim()) {
      this.setData({ errorMsg: '请输入密码' })
      return
    }

    this.setData({ loading: true, errorMsg: '' })

    try {
      const res = await request.post('/auth/login', {
        email: email.trim(),
        password: password
      })

      // 保存登录信息（后端返回 accessToken）
      const token = res.accessToken || res.token
      app.globalData.token = token
      app.globalData.userInfo = res.user
      wx.setStorageSync('token', token)
      wx.setStorageSync('userInfo', res.user)

      wx.reLaunch({ url: '/pages/requirements/index' })
    } catch (err) {
      this.setData({
        errorMsg: err.message || '登录失败，请检查邮箱和密码',
        loading: false
      })
    }
  }
})
