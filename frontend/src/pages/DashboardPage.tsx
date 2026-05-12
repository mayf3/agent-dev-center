import { CheckCircleOutlined, ClockCircleOutlined, CodeOutlined, InboxOutlined } from '@ant-design/icons';
import { App as AntApp, Card, Col, Row, Space, Spin, Statistic, Table, Typography, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PaginatedResponse, Requirement } from '../api/types';
import { PriorityTag } from '../components/PriorityTag';
import { StatusTag } from '../components/StatusTag';

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
      testing: count((i) => ['testing', 'review'].includes(i.status)),
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
        <Col xs={24} sm={12} xl={6}>
          <Card><Statistic title="总需求" value={stats.total} prefix={<InboxOutlined />} /></Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card><Statistic title="待审核" value={stats.pending} prefix={<ClockCircleOutlined />} /></Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card><Statistic title="开发中" value={stats.active} prefix={<CodeOutlined />} /></Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
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
    </Space>
  );
}
