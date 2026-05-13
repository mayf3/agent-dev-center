import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  CloudServerOutlined,
  DesktopOutlined,
  ClockCircleOutlined,
  LinkOutlined,
  LoginOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import { Alert, App as AntApp, Button, Card, Col, Row, Space, Spin, Statistic, Tag, Typography } from 'antd';
import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

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

export function ServicesPage() {
  const { message } = AntApp.useApp();
  const { user, token } = useAuth();
  const [data, setData] = useState<ServicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const fetchStatus = useCallback(async (forceRefresh = false) => {
    try {
      const endpoint = forceRefresh ? '/services/refresh' : '/services/status';
      const method = forceRefresh ? 'post' : 'get';
      const { data: res } = await api[method]<ServicesResponse>(endpoint);
      setData(res);
    } catch {
      message.error('服务状态加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [message]);

  useEffect(() => {
    void fetchStatus();
    // Auto-refresh every 60 seconds
    const timer = setInterval(() => void fetchStatus(), 60_000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  const handleRefresh = () => {
    setRefreshing(true);
    void fetchStatus(true);
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

  const summary = data?.summary ?? { total: 0, online: 0, offline: 0 };
  const local = data?.data.local ?? [];
  const remote = data?.data.remote ?? [];

  const ServiceCard = ({ item, ssoLink = false }: { item: ServiceItem; ssoLink?: boolean }) => {
    const serviceLink = ssoLink ? buildSsoUrl(item.link) : item.link;

    return (
      <Card
        size="small"
        className="service-card"
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
              SSO 跳转
            </Button>
          </Space>
        </div>
      </Card>
    );
  };

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={isMobile ? 4 : 3} style={{ margin: 0 }}>服务监控</Typography.Title>
          <Typography.Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
            所有本地和远程服务运行状态 · 每 60 秒自动刷新
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<ReloadOutlined spin={refreshing} />}
          loading={refreshing}
          onClick={handleRefresh}
        >
          {isMobile ? '刷新' : '立即刷新'}
        </Button>
      </div>

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
            <Statistic title="总服务" value={summary.total} valueStyle={{ fontSize: 28 }} />
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
                value={data?.checkedAt ? new Date(data.checkedAt).toLocaleTimeString('zh-CN') : '-'}
                prefix={<ClockCircleOutlined />}
                valueStyle={{ fontSize: 16, color: '#8c8c8c' }}
              />
            </Card>
          </Col>
        )}
      </Row>

      {/* Local Services */}
      <Card
        title={<Space><DesktopOutlined /> 本地服务 (Mac)</Space>}
        extra={<Tag>{local.length} 个服务</Tag>}
      >
        <Row gutter={[12, 12]}>
          {local.map(svc => (
            <Col xs={24} md={12} xl={8} key={svc.name}>
              <ServiceCard item={svc} />
            </Col>
          ))}
        </Row>
        {local.length === 0 && (
          <Typography.Text type="secondary">暂无本地服务数据</Typography.Text>
        )}
      </Card>

      {/* Remote Services — SSO enabled */}
      <Card
        title={<Space><CloudServerOutlined /> 远程服务 (阿里云) · SSO 可跳转</Space>}
        extra={<Tag color="blue">{remote.length} 个服务</Tag>}
      >
        <Row gutter={[12, 12]}>
          {remote.map(svc => (
            <Col xs={24} md={12} xl={8} key={svc.name}>
              <ServiceCard item={svc} ssoLink />
            </Col>
          ))}
        </Row>
        {remote.length === 0 && (
          <Typography.Text type="secondary">暂无远程服务数据</Typography.Text>
        )}
      </Card>

      {/* Quick Access Portal — all services as large cards */}
      <Card
        title={<Space><CloudServerOutlined /> 统一服务门户 · 一键跳转</Space>}
        extra={<Typography.Text type="secondary">登录一次，跳转所有服务</Typography.Text>}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          点击卡片可直接跳转到对应服务。远程服务已启用 SSO 单点登录，自动携带身份凭证。
        </Typography.Paragraph>
        <Row gutter={[16, 16]}>
          {[...remote.filter(s => s.status === 'online'), ...local.filter(s => s.status === 'online')].map(svc => {
            const jumpUrl = svc.group === 'remote' && token ? buildSsoUrl(svc.link) : svc.link;
            return (
              <Col xs={12} sm={8} md={6} xl={4} key={svc.name}>
                <Card
                  hoverable
                  size="small"
                  style={{ textAlign: 'center', minHeight: 100, cursor: 'pointer' }}
                  onClick={() => window.open(jumpUrl, '_blank', 'noopener,noreferrer')}
                >
                  <div style={{ fontSize: 28, marginBottom: 8 }}>
                    {svc.name.charAt(0) === '🛒' ? '🛒' :
                     svc.name.charAt(0) === '📈' ? '📊' :
                     svc.name.charAt(0) === '📋' ? '📝' :
                     svc.name.charAt(0) === '🔬' ? '🔬' :
                     svc.name.charAt(0) === '✍' ? '✏️' :
                     svc.name.charAt(0) === '🎙' ? '🎙️' :
                     svc.name.charAt(0) === '🌐' ? '🌐' :
                     svc.name.charAt(0) === '🔍' ? '🔍' :
                     svc.name.charAt(0) === '🏠' ? '🏠' :
                     svc.name.charAt(0) === '🔀' ? '🔀' :
                     svc.name.charAt(0) === '📊' ? '📊' :
                     svc.name.charAt(0) === '📱' ? '📱' : '🌐'}
                  </div>
                  <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
                    {svc.name.replace(/^[^\w\s]+\s*/, '')}
                  </Typography.Text>
                  <Space size={4}>
                    <Tag style={{ fontSize: 10 }}>{svc.type}</Tag>
                    {svc.group === 'remote' && token && (
                      <Tag color="blue" style={{ fontSize: 10 }}>SSO</Tag>
                    )}
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
      </Card>
    </Space>
  );
}
