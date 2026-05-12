import { CheckCircleOutlined, ClockCircleOutlined, CodeOutlined, DownloadOutlined, InboxOutlined, MobileOutlined, HistoryOutlined } from '@ant-design/icons';
import { App as AntApp, Badge, Button, Card, Col, Row, Space, Spin, Statistic, Table, Typography, Tag, Popover } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PaginatedResponse, Requirement } from '../api/types';
import { PriorityTag } from '../components/PriorityTag';
import { StatusTag } from '../components/StatusTag';

const APP_VERSION = 'v1.1.0';
const APK_URL = '/downloads/AgentDevCenter-v1.1.0.apk';
const ALT_APK_URL = '/apk/AgentDevCenter-v1.1.0.apk';

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

  // Download Banner Component
  const DownloadBanner = () => (
    <Card
      className="download-banner"
      style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        border: 'none',
        borderRadius: 12,
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ color: '#fff' }}>
          <Space align="center" size={12}>
            <MobileOutlined style={{ fontSize: 28 }} />
            <div>
              <Typography.Text strong style={{ color: '#fff', fontSize: 18, display: 'block' }}>
                下载 Agent Dev Center APP
              </Typography.Text>
              <Typography.Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
                当前版本 {APP_VERSION} · Android APK
              </Typography.Text>
            </div>
          </Space>
        </div>
        <Space>
          <Popover
            title="扫码下载"
            trigger="click"
            content={
              <div style={{ textAlign: 'center', padding: 8 }}>
                <div style={{
                  width: 160, height: 160, background: '#f5f5f5',
                  border: '1px dashed #d9d9d9', borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto'
                }}>
                  <Space direction="vertical" size={2} style={{ textAlign: 'center' }}>
                    <MobileOutlined style={{ fontSize: 32, color: '#1677ff' }} />
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      浏览器扫码<br />打开下载页
                    </Typography.Text>
                  </Space>
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                  或直接下载：
                </Typography.Text>
                <Typography.Link href={APK_URL} style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  {APK_URL}
                </Typography.Link>
              </div>
            }
          >
            <Button ghost style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.6)' }}>
              扫码下载
            </Button>
          </Popover>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            href={APK_URL}
            download
            style={{ background: '#fff', color: '#764ba2', borderColor: '#fff', fontWeight: 600 }}
          >
            直接下载 APK
          </Button>
        </Space>
      </div>
    </Card>
  );

  // Version History Card
  const VersionCard = () => (
    <Card title={<Space><HistoryOutlined /> 版本历史</Space>} size="small" style={{ marginTop: 16 }}>
      {VERSION_HISTORY.map((v, idx) => (
        <div key={v.version} style={{ marginBottom: idx < VERSION_HISTORY.length - 1 ? 12 : 0 }}>
          <Space>
            <Tag color={idx === 0 ? 'blue' : 'default'}>{v.version}</Tag>
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

        <DownloadBanner />

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

      <DownloadBanner />

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

      <VersionCard />
    </Space>
  );
}
