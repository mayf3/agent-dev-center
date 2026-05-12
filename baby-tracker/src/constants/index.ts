import type { AbilityCategory, Activity } from '../types';

export const COLORS = {
  primary: '#FF6B9D',
  primaryLight: '#FF8FB3',
  primaryDark: '#E8557A',
  accent: '#45B7D1',
  accentLight: '#7EC8E3',
  secondary: '#96CEB4',
  secondaryLight: '#B5E0CC',
  warm: '#FFEAA7',
  warmLight: '#FFF3CC',
  background: '#FFF8F0',
  surface: '#FFFFFF',
  text: '#2C3E50',
  textSecondary: '#7F8C8D',
  textTertiary: '#BDC3C7',
  border: '#F0E6D3',
  success: '#27AE60',
  warning: '#F39C12',
  error: '#E74C3C',
};

export const ABILITY_CATEGORIES: AbilityCategory[] = [
  {
    id: 'math', label: '数感与数学', icon: 'calculator',
    items: [
      { id: 'count', label: '数数', desc: '1-100 顺数倒数', score: 0 },
      { id: 'arithmetic', label: '加减法', desc: '10以内加减', score: 0 },
      { id: 'space', label: '空间概念', desc: '方向、图形、位置', score: 0 },
      { id: 'big-num', label: '大数字', desc: '百、千、万认知', score: 0 },
    ],
  },
  {
    id: 'lang', label: '语言与表达', icon: 'chatbubbles',
    items: [
      { id: 'chinese', label: '中文表达', desc: '词汇量、完整句子', score: 0 },
      { id: 'english', label: '英语启蒙', desc: '单词、简单对话', score: 0 },
      { id: 'story', label: '讲故事', desc: '复述、编故事', score: 0 },
      { id: 'reading', label: '阅读习惯', desc: '自主阅读意愿', score: 0 },
    ],
  },
  {
    id: 'science', label: '科学探索', icon: 'flask',
    items: [
      { id: 'curiosity', label: '好奇心', desc: '提问、观察', score: 0 },
      { id: 'experiment', label: '实验思维', desc: '预测、验证', score: 0 },
      { id: 'nature', label: '自然认知', desc: '动植物、天气', score: 0 },
    ],
  },
  {
    id: 'art', label: '艺术创造', icon: 'color-palette',
    items: [
      { id: 'drawing', label: '绘画', desc: '涂色、自由画', score: 0 },
      { id: 'music', label: '音乐', desc: '唱歌、节奏感', score: 0 },
      { id: 'craft', label: '手工', desc: '折纸、黏土', score: 0 },
    ],
  },
  {
    id: 'social', label: '社交能力', icon: 'people',
    items: [
      { id: 'share', label: '分享合作', desc: '轮流、分享玩具', score: 0 },
      { id: 'manners', label: '礼仪', desc: '打招呼、谢谢', score: 0 },
      { id: 'empathy', label: '共情', desc: '理解他人感受', score: 0 },
    ],
  },
  {
    id: 'emotion', label: '情绪管理', icon: 'heart',
    items: [
      { id: 'identify', label: '识别情绪', desc: '说出感受', score: 0 },
      { id: 'express', label: '表达情绪', desc: '不恰当的表达', score: 0 },
      { id: 'regulate', label: '调节情绪', desc: '冷静方法', score: 0 },
    ],
  },
  {
    id: 'selfcare', label: '生活自理', icon: 'shirt',
    items: [
      { id: 'dress', label: '穿衣', desc: '自己穿脱衣物', score: 0 },
      { id: 'eat', label: '吃饭', desc: '独立用餐', score: 0 },
      { id: 'clean', label: '整理', desc: '收拾玩具', score: 0 },
    ],
  },
  {
    id: 'motor', label: '运动能力', icon: 'bicycle',
    items: [
      { id: 'gross', label: '大运动', desc: '跑跳攀爬', score: 0 },
      { id: 'fine', label: '精细动作', desc: '握笔、使用剪刀', score: 0 },
      { id: 'balance', label: '平衡协调', desc: '单脚站、走平衡', score: 0 },
    ],
  },
];

export const SAMPLE_ACTIVITIES: Activity[] = [
  { id: 'a1', title: 'Numberblocks 一起看', type: 'game', category: 'math', materials: ['iPad', 'Numberblocks App'], steps: ['选一集看', '暂停数数', '一起做练习'], duration: '15min', difficulty: 1, done: false },
  { id: 'a2', title: '超市找零游戏', type: 'game', category: 'math', materials: ['硬币/代币', '小商品'], steps: ['设置小卖部', '标价1-10元', '模拟买卖找零'], duration: '20min', difficulty: 2, done: false },
  { id: 'a3', title: '英语闪卡配对', type: 'game', category: 'lang', materials: ['闪卡', '图卡'], steps: ['展示卡片', '说出英文', '配对'], duration: '10min', difficulty: 1, done: false },
  { id: 'a4', title: '绘本共读：猜猜我有多爱你', type: 'reading', category: 'lang', materials: ['绘本'], steps: ['一起读', '模仿动作', '提问理解'], duration: '15min', difficulty: 1, done: false },
  { id: 'a5', title: '厨房小实验：火山爆发', type: 'experiment', category: 'science', materials: ['小苏打', '醋', '杯子'], steps: ['放小苏打', '加醋', '观察反应'], duration: '10min', difficulty: 2, done: false },
  { id: 'a6', title: '户外寻宝游戏', type: 'outdoor', category: 'science', materials: ['清单', '篮子'], steps: ['列寻宝清单', '户外探索', '找到后贴贴纸'], duration: '30min', difficulty: 2, done: false },
  { id: 'a7', title: '水彩自由画', type: 'game', category: 'art', materials: ['水彩', '画纸'], steps: ['准备颜料', '自由创作', '讲画的故事'], duration: '20min', difficulty: 1, done: false },
  { id: 'a8', title: '手工：纸盘动物', type: 'game', category: 'art', materials: ['纸盘', '彩纸', '胶水'], steps: ['选动物', '剪贴制作', '角色扮演'], duration: '25min', difficulty: 2, done: false },
  { id: 'a9', title: '角色扮演：小医生', type: 'game', category: 'social', materials: ['玩具医药箱'], steps: ['装扮小医生', '给娃娃看病', '轮流角色'], duration: '20min', difficulty: 1, done: false },
  { id: 'a10', title: '情绪卡片游戏', type: 'game', category: 'emotion', materials: ['情绪卡片'], steps: ['展示表情', '猜情绪', '什么时候有过'], duration: '10min', difficulty: 2, done: false },
  { id: 'a11', title: '自己穿衣服比赛', type: 'game', category: 'selfcare', materials: ['衣物'], steps: ['计时', '自己穿', '鼓励'], duration: '10min', difficulty: 1, done: false },
  { id: 'a12', title: '公园骑车', type: 'outdoor', category: 'motor', materials: ['自行车/平衡车'], steps: ['戴头盔', '骑车', '挑战小坡'], duration: '30min', difficulty: 2, done: false },
  { id: 'a13', title: '英文歌：Head Shoulders', type: 'game', category: 'lang', materials: ['音箱'], steps: ['听歌', '跟着做动作', '一起唱'], duration: '10min', difficulty: 1, done: false },
  { id: 'a14', title: '数楼梯游戏', type: 'game', category: 'math', materials: [], steps: ['上楼梯数数', '下楼梯倒数', '跳着数'], duration: '5min', difficulty: 1, done: false },
  { id: 'a15', title: '阳台种豆子', type: 'experiment', category: 'science', materials: ['豆子', '棉花', '杯子'], steps: ['放湿棉花', '放豆子', '每天观察记录'], duration: '15min', difficulty: 2, done: false },
];
