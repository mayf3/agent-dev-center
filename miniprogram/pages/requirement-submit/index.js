// pages/requirement-submit/index.js — 提交需求
const request = require('../../utils/request')
const { DEPARTMENTS, PRIORITY_MAP } = require('../../utils/constants')

Page({
  data: {
    title: '',
    description: '',
    priority: 'P2',
    department: '平台产品',
    loading: false,
    submitDisabled: false,
    // 选择器
    priorityIndex: 1,
    priorityOptions: ['P0 紧急', 'P1 高', 'P2 中', 'P3 低'],
    priorityValues: ['P0', 'P1', 'P2', 'P3'],
    departmentIndex: 0,
    departmentOptions: DEPARTMENTS
  },

  onTitleInput(e) { this.setData({ title: e.detail.value }) },
  onDescInput(e) { this.setData({ description: e.detail.value }) },
  onPriorityChange(e) {
    const idx = e.detail.value
    this.setData({ priorityIndex: idx, priority: this.data.priorityValues[idx] })
  },
  onDeptChange(e) {
    this.setData({ departmentIndex: e.detail.value, department: this.data.departmentOptions[e.detail.value] })
  },

  async handleSubmit() {
    const { title, description, priority, department } = this.data

    if (!title.trim()) { wx.showToast({ title: '请输入需求标题', icon: 'none' }); return }
    if (title.trim().length < 2) { wx.showToast({ title: '标题至少2个字符', icon: 'none' }); return }
    if (!description.trim()) { wx.showToast({ title: '请输入需求描述', icon: 'none' }); return }
    if (description.trim().length < 5) { wx.showToast({ title: '描述至少5个字符', icon: 'none' }); return }

    this.setData({ loading: true })
    try {
      const res = await request.post('/requirements', {
        title: title.trim(),
        description: description.trim(),
        priority,
        department
      })
      wx.showToast({ title: '提交成功', icon: 'success' })
      wx.navigateTo({ url: `/pages/requirement-detail/index?id=${res.id}` })
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  goBack() { wx.navigateBack() }
})
