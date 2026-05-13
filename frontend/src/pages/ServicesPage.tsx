import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  CloudServerOutlined,
  DesktopOutlined,
  ClockCircleOutlined,
  LinkOutlined,
  LoginOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
  RightOutlined,
  CodeOutlined,
  UserOutlined,
  GlobalOutlined,
  HomeOutlined,
  DatabaseOutlined,
  TagOutlined,
  CalendarOutlined,
  ToolOutlined
} from '@ant-design/icons';
import { Alert, App as AntApp, Button, Card, Col, Row, Space, Spin, Statistic, Tag, Typography, Tooltip, Empty, Divider } from 'antd';
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import type { RegisteredService } from '../api/types';

// ─── Legacy health-check types ─────────────────────────────────────────

interface ServiceItem {
  name: string;
  group: string;
  port: number;
  url: string;
  type: string;
  link: string;
  status: 'online' | 'offline';
  statusCode: number | null;
  responseTime: number | null;
  checkedAt: string;
}

interface ServicesData {
  local: ServiceItem[];
  remote: ServiceItem[];
}

interface ServicesResponse {
  data: ServicesData;
  summary: { total: number; online: number; offline: number };
  checkedAt: string;
}

// ─── Main page ──────────────────────────────────────────────────────────

export function ServicesPage() {
  const { message } = AntApp.useApp();
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [healthData, setHealthData] = useState<ServicesResponse | null>(null);
  const [registeredServices, setRegisteredServices] = useState<RegisteredService[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [activeTab, setActiveTab] = useState<'registry' | 'health'>('registry');

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const fetchHealth = useCallback(async (forceRefresh = false) => {
    try {
      const endpoint = forceRefresh ? '/services/refresh' : '/services/status';
      const method = forceRefresh ? 'post' : 'get';
      const { data: res } = await api[method]<ServicesResponse>(endpoint);
      setHealthData(res);
    } catch {
      // health check failure is non-critical
    }
  }, []);

  const fetchRegistered = useCallback(async () => {
    try {
      const { data: res } = await api.get<{ data: RegisteredService[]; pagination: { total: number } }>('/services', {
        params: { limit: 50 },
      });
      setRegisteredServices(res.data ?? []);
    } catch {
      message.error('服务注册列表加载失败');
    }
  }, [message]);

  const fetchAll = useCallback(async (forceRefresh = false) => {
    try {
      await Promise.all([fetchHealth(forceRefresh), fetchRegistered()]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchHealth, fetchRegistered]);

  useEffect(() => {
    void fetchAll();
    const timer = setInterval(() => void fetchAll(), 60_000);
    return () => clearInterval(timer);
  }, [fetchAll]);

  const handleRefresh = () => {
    setRefreshing(true);
    void fetchAll(true);
  };

  const buildSsoUrl = useCallback((link: string) => {
    if (!token) return link;
    try {
      const url = new URL(link, window.location.origin);
      url.searchParams.set('token', token);
      return url.toString();
    } catch {
      const separator = link.includes('?') ? '&' : '?';
      return `${link}${separator}token=${encodeURIComponent(token)}`;
    }
  }, [token]);

  const handleSsoJump = useCallback((item: ServiceItem) => {
    if (!token) {
      message.warning('当前登录 Token 缺失，无法进行 SSO 跳转');
      return;
    }
    window.open(buildSsoUrl(item.link), '_blank', 'noopener,noreferrer');
  }, [buildSsoUrl, message, token]);

  if (loading) return <Spin className="page-spin" />;

  const summary = healthData?.summary ?? { total: 0, online: 0, offline: 0 };

  // ─── Status helper ──────────────────────────────────────────────
  const statusDot = (status: string) => {
    switch (status) {
      case 'online': return <Tag color="success" style={{ fontSize: 11 }}>🟢 在线</Tag>;
      case 'offline': return <Tag color="error" style={{ fontSize: 11 }}>🔴 离线</Tag>;
      case 'maintenance': return <Tag color="warning" style={{ fontSize: 11 }}>🟡 维护</Tag>;
      default: return <Tag style={{ fontSize: 11 }}>⚪ 未知</Tag>;
    }
  };

  // ─── Registered Service Card (new) ──────────────────────────────
  const RegisteredServiceCard = ({ svc }: { svc: RegisteredService }) => (
    <Card
      hoverable
      size="small"
      style={{
        borderLeft: `3px solid ${svc.status === 'online' ? '#52c41a' : svc.status === 'offline' ? '#ff4d4f' : '#faad14'}`,
        height: '100%',
      }}
      onClick={() => navigate(`/services/${svc.id}`)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <Space size={6} wrap>
          <Typography.Text strong style={{ fontSize: 14 }}>{svc.displayName}</Typography.Text>
          {statusDot(svc.status)}
        </Space>
        <RightOutlined style={{ color: '#999', fontSize: 12 }} />
      </div>
      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.4 }}
        ellipsis={{ rows: 2 }}
      >
        {svc.description}
      </Typography.Paragraph>
      <Space size={[4, 4]} wrap style={{ marginBottom: 8 }}>
        {svc.techStack.slice(0, 4).map(t => (
          <Tag key={t} style={{ fontSize: 10, margin: 0 }}>{t}</Tag>
        ))}
        {svc.techStack.length > 4 && (
          <Tag style={{ fontSize: 10, margin: 0 }}>+{svc.techStack.length - 4}</Tag>
        )}
      </Space>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#8c8c8c' }}>
        <Space size={12}>
          {svc.owner && (
            <span><UserOutlined /> {svc.owner}</span>
          )}
          {svc.port && (
            <span><GlobalOutlined /> :{svc.port}</span>
          )}
          {svc.version && (
            <span>v{svc.version}</span>
          )}
        </Space>
        {svc.lastDeployedAt && (
          <Tooltip title="最后部署时间">
            <span><CalendarOutlined /> {new Date(svc.lastDeployedAt).toLocaleDateString('zh-CN')}</span>
          </Tooltip>
        )}
      </div>
    </Card>
  );

  // ─── Legacy Health Card ─────────────────────────────────────────
  const HealthCard = ({ item, ssoLink = false }: { item: ServiceItem; ssoLink?: boolean }) => {
    const serviceLink = ssoLink ? buildSsoUrl(item.link) : item.link;
    return (
      <Card
        size="small"
        style={{
          borderLeft: `3px solid ${item.status === 'online' ? '#52c41a' : '#ff4d4f'}`,
          marginBottom: isMobile ? 8 : 0,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          <Space size={6} wrap>
            {item.status === 'online'
              ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 14 }} />
              : <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
            }
            <Typography.Text strong style={{ fontSize: 14 }}>{item.name}</Typography.Text>
            <Tag style={{ fontSize: 11 }}>{item.type}</Tag>
          </Space>
          <Space size={8} wrap>
            {item.responseTime != null && (
              <Tag icon={<ThunderboltOutlined />} color={item.responseTime < 200 ? 'green' : item.responseTime < 1000 ? 'orange' : 'red'}>
                {item.responseTime}ms
              </Tag>
            )}
            <Tag color={item.status === 'online' ? 'success' : 'error'}>
              {item.status === 'online' ? '在线' : '离线'}
            </Tag>
            <a href={serviceLink} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
              <LinkOutlined /> :{item.port}
            </a>
            <Button
              type="primary"
              size="small"
              icon={<LoginOutlined />}
              disabled={!token}
              onClick={() => handleSsoJump(item)}
            >
              SSO
            </Button>
          </Space>
        </div>
      </Card>
    );
  };

  const local = healthData?.data.local ?? [];
  const remote = healthData?.data.remote ?? [];

  return (
    <Space direction="vertical" size="large" className="page-stack">
      {/* Header */}
      <div className="page-heading">
        <div>
          <Typography.Title level={isMobile ? 4 : 3} style={{ margin: 0 }}>服务注册中心</Typography.Title>
          <Typography.Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
            服务管理 + 健康监控 · 每 60 秒自动刷新
          </Typography.Text>
        </div>
        <Space>
          <Button
            size={isMobile ? 'small' : 'middle'}
            icon={<AppstoreOutlined />}
            type={activeTab === 'registry' ? 'primary' : 'default'}
            onClick={() => setActiveTab('registry')}
          >
            注册中心
          </Button>
          <Button
            size={isMobile ? 'small' : 'middle'}
            icon={<CloudServerOutlined />}
            type={activeTab === 'health' ? 'primary' : 'default'}
            onClick={() => setActiveTab('health')}
          >
            健康监控
          </Button>
          <Button
            type="primary"
            icon={<ReloadOutlined spin={refreshing} />}
            loading={refreshing}
            onClick={handleRefresh}
          >
            {isMobile ? '刷新' : '立即刷新'}
          </Button>
        </Space>
      </div>

      {/* SSO alert */}
      <Alert
        showIcon
        type={token ? 'success' : 'warning'}
        message={
          <Space size={8} wrap>
            <Typography.Text strong>SSO 单点登录已启用</Typography.Text>
            <Typography.Text>当前用户：{user?.name ?? '未登录'}</Typography.Text>
            <Tag color={token ? 'success' : 'warning'}>
              Token {token ? '已就绪' : '缺失'}
            </Tag>
          </Space>
        }
        description={token ? '已登录，可以通过服务卡片跳转到所有服务。' : '未检测到登录 Token，SSO 跳转暂不可用。'}
      />

      {/* Stats */}
      <Row gutter={[16, 16]}>
        <Col xs={8} sm={8} md={6}>
          <Card size="small">
            <Statistic title="已注册服务" value={registeredServices.length} valueStyle={{ fontSize: 28 }} />
          </Card>
        </Col>
        <Col xs={8} sm={8} md={6}>
          <Card size="small">
            <Statistic
              title="在线"
              value={summary.online}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ fontSize: 28, color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={8} sm={8} md={6}>
          <Card size="small">
            <Statistic
              title="离线"
              value={summary.offline}
              prefix={<CloseCircleOutlined />}
              valueStyle={{ fontSize: 28, color: summary.offline > 0 ? '#ff4d4f' : '#8c8c8c' }}
            />
          </Card>
        </Col>
        {!isMobile && (
          <Col md={6}>
            <Card size="small">
              <Statistic
                title="上次检查"
                value={healthData?.checkedAt ? new Date(healthData.checkedAt).toLocaleTimeString('zh-CN') : '-'}
                prefix={<ClockCircleOutlined />}
                valueStyle={{ fontSize: 16, color: '#8c8c8c' }}
              />
            </Card>
          </Col>
        )}
      </Row>

      {/* Tab: Registry */}
      {activeTab === 'registry' && (
        <>
          <Card
            title={<Space><AppstoreOutlined /> 已注册服务</Space>}
            extra={<Tag color="blue">{registeredServices.length} 个服务</Tag>}
          >
            {registeredServices.length === 0 ? (
              <Empty description="暂无已注册服务" />
            ) : (
              <Row gutter={[16, 16]}>
                {registeredServices.map(svc => (
                  <Col xs={24} sm={12} md={8} xl={6} key={svc.id}>
                    <RegisteredServiceCard svc={svc} />
                  </Col>
                ))}
              </Row>
            )}
          </Card>
        </>
      )}

      {/* Tab: Health Monitor */}
      {activeTab === 'health' && (
        <>
          <Card
            title={<Space><DesktopOutlined /> 本地服务 (Mac)</Space>}
            extra={<Tag>{local.length} 个服务</Tag>}
          >
            <Row gutter={[12, 12]}>
              {local.map(svc => (
                <Col xs={24} md={12} xl={8} key={svc.name}>
                  <HealthCard item={svc} />
                </Col>
              ))}
            </Row>
            {local.length === 0 && (
              <Typography.Text type="secondary">暂无本地服务数据</Typography.Text>
            )}
          </Card>

          <Card
            title={<Space><CloudServerOutlined /> 远程服务 (阿里云) · SSO 可跳转</Space>}
            extra={<Tag color="blue">{remote.length} 个服务</Tag>}
          >
            <Row gutter={[12, 12]}>
              {remote.map(svc => (
                <Col xs={24} md={12} xl={8} key={svc.name}>
                  <HealthCard item={svc} ssoLink />
                </Col>
              ))}
            </Row>
            {remote.length === 0 && (
              <Typography.Text type="secondary">暂无远程服务数据</Typography.Text>
            )}
          </Card>
        </>
      )}
    </Space>
  );
}
