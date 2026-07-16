import { AimOutlined, CheckCircleOutlined, ClockCircleOutlined, CodeOutlined, InboxOutlined, RocketOutlined, StarFilled, TrophyOutlined } from '@ant-design/icons';
import { App as AntApp, Badge, Button, Card, Col, Row, Space, Spin, Statistic, Tooltip, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { PaginatedResponse, Requirement } from '../../api/types';

// ==================== 游戏化城市 Canvas ====================

interface Building {
  x: number;
  width: number;
  height: number;
  color: string;
  label: string;
  agentId: string;
  completedTasks: number;
  animHeight: number; // 动画过渡用
}

interface Milestone {
  x: number;
  y: number;
  label: string;
  completed: boolean;
  current: boolean;
}

interface Star {
  x: number;
  y: number;
  size: number;
  alpha: number;
  speed: number;
}

// 为每个 Agent 分配建筑颜色
const BUILDING_COLORS = [
  '#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#13c2c2',
  '#eb2f96', '#faad14', '#2f54eb', '#a0d911', '#f5222d',
];

const BUILDING_WIDTHS = [40, 48, 44, 52, 38, 46, 50, 42, 54, 36];

function drawCity(ctx: CanvasRenderingContext2D, width: number, height: number, buildings: Building[], milestones: Milestone[], stars: Star[], isNight: boolean) {
  const dpr = window.devicePixelRatio || 1;

  // 背景渐变 (天空)
  const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
  if (isNight) {
    skyGrad.addColorStop(0, '#0a1628');
    skyGrad.addColorStop(0.5, '#1a3a5c');
    skyGrad.addColorStop(1, '#2a5a7a');
  } else {
    skyGrad.addColorStop(0, '#667eea');
    skyGrad.addColorStop(0.5, '#764ba2');
    skyGrad.addColorStop(1, '#87ceeb');
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height);

  // 星星
  stars.forEach((star) => {
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 200, ${star.alpha})`;
    ctx.fill();
  });

  // 地面
  const groundY = height * 0.65;
  const groundGrad = ctx.createLinearGradient(0, groundY, 0, height);
  groundGrad.addColorStop(0, '#2d8a4e');
  groundGrad.addColorStop(0.3, '#1a6b3a');
  groundGrad.addColorStop(1, '#0d3b20');
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, groundY, width, height - groundY);

  // 道路
  ctx.fillStyle = '#4a4a5a';
  ctx.fillRect(0, groundY - 4, width, 8);
  // 道路虚线
  ctx.strokeStyle = '#ffdd57';
  ctx.lineWidth = 2;
  ctx.setLineDash([15, 15]);
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();
  ctx.setLineDash([]);

  // 里程碑路径
  const pathY = groundY - 30;
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  milestones.forEach((m, i) => {
    if (i === 0) ctx.moveTo(m.x, m.y);
    else ctx.lineTo(m.x, m.y);
  });
  ctx.stroke();

  // 里程碑节点
  milestones.forEach((m) => {
    // 外光晕
    const glow = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 18);
    if (m.current) {
      glow.addColorStop(0, 'rgba(255, 215, 0, 0.6)');
      glow.addColorStop(1, 'rgba(255, 215, 0, 0)');
    } else if (m.completed) {
      glow.addColorStop(0, 'rgba(82, 196, 26, 0.4)');
      glow.addColorStop(1, 'rgba(82, 196, 26, 0)');
    } else {
      glow.addColorStop(0, 'rgba(150, 150, 150, 0.3)');
      glow.addColorStop(1, 'rgba(150, 150, 150, 0)');
    }
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 18, 0, Math.PI * 2);
    ctx.fill();

    // 节点
    ctx.beginPath();
    ctx.arc(m.x, m.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = m.completed ? '#52c41a' : m.current ? '#ffd700' : '#8c8c8c';
    ctx.fill();
    if (m.current) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 里程碑标签
    ctx.fillStyle = m.completed || m.current ? '#fff' : '#888';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(m.label, m.x, m.y + 25);
  });

  // 建筑 (城市天际线)
  buildings.forEach((b) => {
    const bw = b.width * dpr;
    const bh = b.animHeight * dpr;
    const bx = b.x * dpr;
    const by = (groundY - b.animHeight) * dpr;

    // 建筑主体
    const grad = ctx.createLinearGradient(bx, by, bx + bw, by);
    grad.addColorStop(0, lightenColor(b.color, 20));
    grad.addColorStop(0.5, b.color);
    grad.addColorStop(1, darkenColor(b.color, 20));
    ctx.fillStyle = grad;

    const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };

    roundRect(bx, by, bw, b.animHeight * dpr, 4);
    ctx.fill();

    // 窗户（随机亮点）
    const windowSize = 4 * dpr;
    const windowGap = 8 * dpr;
    const windowsPerRow = Math.floor((bw - windowGap) / (windowSize + windowGap));
    const windowRows = Math.floor((b.animHeight * dpr - 15 * dpr) / (windowSize + windowGap));
    const windowStartX = bx + windowGap;
    const windowStartY = by + 10 * dpr;

    for (let row = 0; row < windowRows && row < 10; row++) {
      for (let col = 0; col < windowsPerRow && col < 5; col++) {
        const wx = windowStartX + col * (windowSize + windowGap);
        const wy = windowStartY + row * (windowSize + windowGap);

        // 随机亮灯
        const lit = (b.completedTasks * 7 + row * 3 + col * 7) % 10 > 4;
        ctx.fillStyle = lit ? 'rgba(255, 255, 200, 0.8)' : 'rgba(50, 50, 80, 0.5)';
        ctx.fillRect(wx, wy, windowSize, windowSize);
      }
    }

    // 屋顶装饰（根据完成度）
    if (b.completedTasks >= 3) {
      // 烟囱
      ctx.fillStyle = darkenColor(b.color, 30);
      ctx.fillRect(bx + bw * 0.3, by - 10 * dpr, 8 * dpr, 12 * dpr);
    }
    if (b.completedTasks >= 5) {
      // 旗帜
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.arc(bx + bw / 2, by - 8 * dpr, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      // 旗杆
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(bx + bw / 2, by);
      ctx.lineTo(bx + bw / 2, by - 12 * dpr);
      ctx.stroke();
    }

    // 建筑标签
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${11 * dpr}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(b.label, bx + bw / 2, by - 2 * dpr);

    // 完成数
    ctx.fillStyle = '#ffd700';
    ctx.font = `${10 * dpr}px -apple-system, sans-serif`;
    ctx.fillText(`⭐${b.completedTasks}`, bx + bw / 2, by + b.animHeight * dpr + 14 * dpr);
  });
}

// ==================== 颜色工具 ====================

function lightenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + percent);
  const g = Math.min(255, ((num >> 8) & 0x00ff) + percent);
  const b = Math.min(255, (num & 0x0000ff) + percent);
  return `rgb(${r}, ${g}, ${b})`;
}

function darkenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - percent);
  const g = Math.max(0, ((num >> 8) & 0x00ff) - percent);
  const b = Math.max(0, (num & 0x0000ff) - percent);
  return `rgb(${r}, ${g}, ${b})`;
}

// ==================== 主页面组件 ====================

export function GameDashboardPage() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [isNight, setIsNight] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [stars, setStars] = useState<Star[]>([]);
  const frameRef = useRef(0);

  // 加载数据
  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get<PaginatedResponse<Requirement>>('/requirements', {
          params: { page: 1, pageSize: 200 }
        });
        setRequirements(data.data);
      } catch {
        message.error('数据加载失败');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [message]);

  // 构建游戏世界数据
  useEffect(() => {
    if (requirements.length === 0) return;

    // 按 assignee 分组统计完成的任务数
    const agentStats = new Map<string, { name: string; done: number; total: number }>();

    // 收集所有人（包括未分配的）
    requirements.forEach((req) => {
      const agentId = req.assignee || 'unassigned';
      const name = req.assignee ? req.assignee : '未分配';

      if (!agentStats.has(agentId)) {
        agentStats.set(agentId, { name, done: 0, total: 0 });
      }
      const stat = agentStats.get(agentId)!;
      stat.total++;
      if (req.status === 'done') stat.done++;
    });

    // 转成建筑数据
    const agents = Array.from(agentStats.entries())
      .filter(([id]) => id !== 'unassigned')  // 排除未分配
      .sort((a, b) => b[1].done - a[1].done)
      .slice(0, 10);  // 最多10个

    const canvas = canvasRef.current;
    const canvasWidth = canvas?.offsetWidth || 1200;
    const gap = canvasWidth / (agents.length + 1);

    const newBuildings: Building[] = agents.map(([agentId, stat], i) => {
      const maxHeight = 180;
      const minHeight = 30;
      const ratio = stat.total > 0 ? stat.done / stat.total : 0;
      const height = minHeight + ratio * maxHeight;

      return {
        x: gap * (i + 1),
        width: BUILDING_WIDTHS[i % BUILDING_WIDTHS.length],
        height: Math.max(height, 30),
        color: BUILDING_COLORS[i % BUILDING_COLORS.length],
        label: stat.name.length > 4 ? stat.name.slice(0, 4) + '..' : stat.name,
        agentId,
        completedTasks: stat.done,
        animHeight: 0, // 从0开始动画
      };
    });

    // 里程碑
    const statusStages = [
      { key: 'pending', label: '📋 待审' },
      { key: 'approved', label: '✅ 通过' },
      { key: 'in-progress', label: '⚡ 开发' },
      { key: 'testing', label: '🔬 测试' },
      { key: 'done', label: '🎉 完成' },
    ];

    const mw = canvasWidth - 80;
    const mGap = mw / (statusStages.length - 1);

    // 计算各阶段完成数
    const stageCounts = statusStages.map((s) => {
      if (s.key === 'done') return requirements.filter((r) => r.status === 'done').length;
      if (s.key === 'testing') return requirements.filter((r) => r.status === 'testing').length;
      if (s.key === 'in-progress') return requirements.filter((r) => ['in-progress', 'approved'].includes(r.status)).length;
      if (s.key === 'approved') return requirements.filter((r) => r.status === 'approved').length;
      return requirements.filter((r) => r.status === 'pending').length;
    });

    // 找到当前活跃阶段
    let currentStageIdx = statusStages.length - 1;
    for (let i = statusStages.length - 1; i >= 0; i--) {
      if (stageCounts[i] > 0 || (i > 0 && stageCounts[i - 1] > 0)) {
        currentStageIdx = i;
        break;
      }
    }

    const newMilestones: Milestone[] = statusStages.map((s, i) => ({
      x: 40 + mGap * i,
      y: 0, // canvas 渲染时按比例计算 y
      label: `${s.label} ${stageCounts[i]}`,
      completed: i < currentStageIdx || (i === currentStageIdx && stageCounts[i] === 0 && i > 0),
      current: i === currentStageIdx,
    }));

    setBuildings(newBuildings);
    setMilestones(newMilestones);

    // 星星
    const newStars: Star[] = Array.from({ length: 60 }, () => ({
      x: Math.random() * canvasWidth,
      y: Math.random() * (canvasWidth * 0.45),
      size: Math.random() * 2 + 0.5,
      alpha: Math.random() * 0.7 + 0.3,
      speed: Math.random() * 0.005 + 0.002,
    }));
    setStars(newStars);

    // 白天/夜晚
    setIsNight(new Date().getHours() < 6 || new Date().getHours() >= 18);
  }, [requirements]);

  // Canvas 动画循环
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || buildings.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const groundY = rect.height * 0.65;

    const animate = () => {
      const w = rect.width;
      const h = rect.height;
      frameRef.current++;

      // 建筑拔高动画
      let allDone = true;
      const updatedBuildings = buildings.map((b) => {
        if (b.animHeight < b.height) {
          allDone = false;
          return { ...b, animHeight: Math.min(b.animHeight + 3, b.height) };
        }
        return b;
      });

      // 更新步进动画
      if (!allDone) {
        setBuildings(updatedBuildings);
      }

      // 星星闪烁
      const updatedStars = stars.map((s) => ({
        ...s,
        alpha: 0.3 + Math.sin(frameRef.current * s.speed) * 0.4,
      }));

      // 里程碑位置（随着建筑生长而下降）
      const milestoneY = groundY - 30 - (allDone ? 0 : 20);

      // 绘制
      ctx.clearRect(0, 0, w, h);
      drawCity(ctx, w, h, updatedBuildings, milestones.map(m => ({ ...m, y: milestoneY })), updatedStars, isNight);

      animRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [buildings, milestones, stars, isNight]);

  // 统计
  const stats = {
    total: requirements.length,
    pending: requirements.filter((r) => r.status === 'pending').length,
    active: requirements.filter((r) => ['approved', 'in-progress'].includes(r.status)).length,
    testing: requirements.filter((r) => r.status === 'testing').length,
    done: requirements.filter((r) => r.status === 'done').length,
    completionRate: requirements.length > 0
      ? Math.round((requirements.filter((r) => r.status === 'done').length / requirements.length) * 100)
      : 0,
  };

  if (loading) return <Spin className="page-spin" />;

  return (
    <Space direction="vertical" size="middle" className="page-stack" style={{ width: '100%' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            <RocketOutlined style={{ marginRight: 8 }} />
            进展之城 🏙️
          </Typography.Title>
          <Typography.Text type="secondary">
            每个建筑代表一位 Agent，越高完成的需求越多
          </Typography.Text>
        </div>
        <Badge
          count={stats.completionRate}
          showZero
          style={{
            backgroundColor: stats.completionRate > 80 ? '#52c41a' : stats.completionRate > 50 ? '#fa8c16' : '#1677ff',
            padding: '4px 12px',
            fontSize: 16,
            fontWeight: 'bold',
            borderRadius: 20,
          }}
        >
          <span style={{ marginRight: 8 }}>完成率</span>
        </Badge>
      </div>

      {/* Canvas 城市 */}
      <Card
        style={{ borderRadius: 12, overflow: 'hidden', padding: 0 }}
        bodyStyle={{ padding: 0 }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 400, display: 'block' }}
        />
      </Card>

      {/* 统计行 */}
      <Row gutter={[12, 12]}>
        <Col xs={12} sm={8} xl={4}>
          <Card size="small" hoverable onClick={() => navigate('/requirements')}>
            <Statistic title="总需求" value={stats.total} prefix={<InboxOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card size="small">
            <Statistic title="待审核" value={stats.pending} prefix={<ClockCircleOutlined />} valueStyle={{ color: '#fa8c16' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card size="small">
            <Statistic title="开发中" value={stats.active} prefix={<CodeOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card size="small">
            <Statistic title="测试中" value={stats.testing} prefix={<AimOutlined />} valueStyle={{ color: '#722ed1' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card size="small">
            <Statistic title="已完成 🎉" value={stats.done} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card size="small" hoverable onClick={() => navigate('/team')}>
            <Statistic title="活跃 Agent" value={buildings.length} prefix={<TrophyOutlined />} valueStyle={{ color: '#722ed1' }} />
          </Card>
        </Col>
      </Row>

      {/* 建筑图例 */}
      <Card title={<Space><StarFilled style={{ color: '#ffd700' }} /> Agent 排行榜</Space>} size="small">
        <Row gutter={[8, 8]}>
          {buildings.map((b, i) => (
            <Col xs={12} sm={8} md={6} lg={4} key={b.agentId}>
              <Card
                size="small"
                hoverable
                onClick={() => navigate(`/identity?type=agent&id=${b.agentId}`)}
                style={{ borderLeft: `3px solid ${b.color}` }}
              >
                <Space direction="vertical" size={0} style={{ width: '100%' }}>
                  <Typography.Text strong style={{ fontSize: 13 }}>{b.label}</Typography.Text>
                  <Space size={4}>
                    <Badge
                      count={b.completedTasks}
                      style={{
                        backgroundColor: '#ffd700',
                        color: '#333',
                        fontSize: 11,
                        fontWeight: 'bold',
                      }}
                      showZero
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      完成需求
                    </Typography.Text>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    排名 #{i + 1}
                  </Typography.Text>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      {/* 里程碑路径说明 */}
      <Card title={<Space><AimOutlined /> 里程碑路径</Space>} size="small">
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          📋 待审 → ✅ 通过 → ⚡ 开发 → 🔬 测试 → 🎉 完成
        </Typography.Paragraph>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          需求在里程碑路径上前进，每穿过一个阶段就是一个小成就！
          {stats.done > 0 && ` 已经有 ${stats.done} 个需求走到了终点 🎊`}
        </Typography.Text>
      </Card>
    </Space>
  );
}
