import { CheckCircleOutlined, ClockCircleOutlined, CodeOutlined, InboxOutlined, HistoryOutlined } from '@ant-design/icons';
import { App as AntApp, Badge, Button, Card, Col, Row, Space, Spin, Statistic, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PaginatedResponse, Requirement } from '../api/types';
import { PriorityTag } from '../components/PriorityTag';
import { StatusTag } from '../components/StatusTag';

const VERSION_HISTORY = [
  { version: 'v1.1.0', date: '2026-05-10', changes: ['需求详情页', '验收报告模块', '开发看板拖拽', 'APP图标更新'] },
  { version: 'v1.0.0', date: '2026-04-20', changes: ['初始版本', '需求管理CRUD', '任务分配', '用户认证'] },
];

export function DashboardPage() {
  const { message } = AntApp.useApp();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get<PaginatedResponse<Requirement>>('/requirements', {
          params: { page: 1, pageSize: 100 }
        });
        setRequirements(data.data);
      } catch {
        message.error('仪表盘数据加载失败');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [message]);

  const stats = useMemo(() => {
    const count = (p: (item: Requirement) => boolean) => requirements.filter(p).length;
    return {
      total: requirements.length,
      pending: count((i) => i.status === 'pending'),
      active: count((i) => ['approved', 'in-progress'].includes(i.status)),
      testing: count((i) => i.status === 'testing'),
      review: count((i) => ['review', 'deploying'].includes(i.status)),
      done: count((i) => i.status === 'done')
    };
  }, [requirements]);

  const columns: ColumnsType<Requirement> = [
    { title: '需求', dataIndex: 'title', render: (_, r) => <Link to={`/requirements/${r.id}`}>{r.title}</Link> },
    { title: '优先级', dataIndex: 'priority', width: 100, render: (p) => <PriorityTag priority={p} /> },
    { title: '状态', dataIndex: 'status', width: 100, render: (s) => <StatusTag status={s} /> },
    { title: '负责人', dataIndex: 'assignee', width: 140, render: (a) => a || '未分配' },
    { title: '更新', dataIndex: 'updatedAt', width: 140, render: (v) => dayjs(v).format('MM-DD HH:mm') }
  ];

  if (loading) return <Spin className="page-spin" />;

  // Version History Card
  const VersionCard = () => (
    <Card title={<Space><HistoryOutlined /> 版本历史</Space>} size="small" style={{ marginTop: 16 }}>
      {VERSION_HISTORY.map((v, idx) => (
        <div key={v.version} style={{ marginBottom: idx < VERSION_HISTORY.length - 1 ? 12 : 0 }}>
          <Space>
            <Badge status={idx === 0 ? 'processing' : 'default'} />
            <Typography.Text strong={idx === 0}>{v.version}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v.date}</Typography.Text>
          </Space>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 13, color: '#666' }}>
            {v.changes.map(c => <li key={c}>{c}</li>)}
          </ul>
        </div>
      ))}
    </Card>
  );

  // Mobile Layout
  if (isMobile) {
    return (
      <Space direction="vertical" size="middle" className="page-stack">
        <div>
          <Typography.Title level={4}>仪表盘</Typography.Title>
          <Typography.Text type="secondary">实时概览</Typography.Text>
        </div>

        <div className="mobile-stats-grid">
          <div className="mobile-stat-card">
            <div className="stat-value" style={{ color: '#1677ff' }}>{stats.total}</div>
            <div className="stat-label">总需求</div>
          </div>
          <div className="mobile-stat-card">
            <div className="stat-value" style={{ color: '#fa8c16' }}>{stats.pending}</div>
            <div className="stat-label">待审核</div>
          </div>
          <div className="mobile-stat-card">
            <div className="stat-value" style={{ color: '#1677ff' }}>{stats.active}</div>
            <div className="stat-label">开发中</div>
          </div>
          <div className="mobile-stat-card">
            <div className="stat-value" style={{ color: '#722ed1' }}>{stats.testing}</div>
            <div className="stat-label">测试中</div>
          </div>
          <div className="mobile-stat-card">
            <div className="stat-value" style={{ color: '#13c2c2' }}>{stats.review}</div>
            <div className="stat-label">验收/部署</div>
          </div>
          <div className="mobile-stat-card">
            <div className="stat-value" style={{ color: '#52c41a' }}>{stats.done}</div>
            <div className="stat-label">已完成</div>
          </div>
        </div>

        <Card title="最近更新" size="small">
          {requirements.slice(0, 8).map((item) => (
            <div
              key={item.id}
              className="mobile-req-card"
              onClick={() => window.location.href = `/requirements/${item.id}`}
              style={{ marginBottom: 8 }}
            >
              <div className="mobile-req-card-title">{item.title}</div>
              <div className="mobile-req-card-meta">
                <PriorityTag priority={item.priority} />
                <StatusTag status={item.status} />
                <span>{item.assignee || '未分配'}</span>
              </div>
            </div>
          ))}
        </Card>

        <VersionCard />
      </Space>
    );
  }

  // Desktop Layout
  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div>
        <Typography.Title level={3}>仪表盘</Typography.Title>
        <Typography.Text type="secondary">从需求提交、审核、开发到交付的实时概览</Typography.Text>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} xl={4}>
          <Card><Statistic title="总需求" value={stats.total} prefix={<InboxOutlined />} /></Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card><Statistic title="待审核" value={stats.pending} prefix={<ClockCircleOutlined />} /></Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card><Statistic title="开发中" value={stats.active} prefix={<CodeOutlined />} /></Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card><Statistic title="测试中" value={stats.testing} valueStyle={{ color: '#722ed1' }} /></Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card><Statistic title="验收/部署" value={stats.review} valueStyle={{ color: '#13c2c2' }} /></Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card><Statistic title="已完成" value={stats.done} prefix={<CheckCircleOutlined />} /></Card>
        </Col>
      </Row>

      <Card title="最近更新">
        <Table
          rowKey="id" columns={columns}
          dataSource={requirements.slice(0, 8)}
          pagination={false} scroll={{ x: 760 }}
        />
      </Card>

      <VersionCard />
    </Space>
  );
}
