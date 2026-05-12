// utils/request.js — 网络请求封装
const app = getApp()

class Request {
  get(url, data = {}) {
    return this._request('GET', url, data)
  }

  post(url, data = {}) {
    return this._request('POST', url, data)
  }

  put(url, data = {}) {
    return this._request('PUT', url, data)
  }

  patch(url, data = {}) {
    return this._request('PATCH', url, data)
  }

  del(url, data = {}) {
    return this._request('DELETE', url, data)
  }

  _request(method, url, data) {
    return new Promise((resolve, reject) => {
      const token = app.globalData.token || wx.getStorageSync('token')
      const baseUrl = app.globalData.baseUrl

      wx.request({
        url: baseUrl + url,
        method,
        data,
        header: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        success: (res) => {
          if (res.statusCode === 401) {
            app.logout()
            reject({ message: '登录已过期，请重新登录', code: 401 })
            return
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data)
          } else {
            const msg = (res.data && res.data.message) || '请求失败'
            reject({ message: msg, code: res.statusCode })
          }
        },
        fail: (err) => {
          reject({ message: '网络异常，请检查网络连接', code: 0 })
        }
      })
    })
  }
}

const request = new Request()
module.exports = request
