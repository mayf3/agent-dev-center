import {
  LoginOutlined,
  GlobalOutlined,
  HomeOutlined,
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  LogoutOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { Alert, App as AntApp, Button, Card, Col, Row, Space, Spin, Typography, Tag, Avatar, Divider, Result } from 'antd';
import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import type { RegisteredService } from '../api/types';

interface SsoServiceItem {
  name: string;
  displayName: string;
  url: string | null;
  status: string;
}

export function SsoPortalPage() {
  const { user, token, isAuthenticated, loginWithToken, logout } = useAuth();
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [services, setServices] = useState<SsoServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Handle SSO token from query param
  useEffect(() => {
    const ssoToken = searchParams.get('token');
    if (ssoToken && !isAuthenticated) {
      loginWithToken(ssoToken).catch(() => {
        message.error('SSO Token 验证失败，请重新登录');
      });
    }
  }, [searchParams, isAuthenticated, loginWithToken, message]);

  // Fetch services for portal
  const fetchServices = useCallback(async () => {
    if (!isAuthenticated || !token) {
      setLoading(false);
      return;
    }
    try {
      // Try SSO login endpoint for services list, fallback to services API
      const { data: res } = await api.get<{ data: RegisteredService[] }>('/services', {
        params: { limit: 50 },
        headers: { Authorization: `Bearer ${token}` },
      });
      const items = (res.data ?? []).map((s) => ({
        name: s.name,
        displayName: s.displayName,
        url: s.remoteUrl ?? s.localUrl ?? null,
        status: s.status,
      }));
      setServices(items);
    } catch {
      // Fallback: empty list
      setServices([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, token]);

  useEffect(() => {
    void fetchServices();
  }, [fetchServices]);

  const buildServiceUrl = useCallback(
    (url: string) => {
      if (!token) return url;
      try {
        const parsed = new URL(url);
        parsed.searchParams.set('token', token);
        return parsed.toString();
      } catch {
        return `${url}?token=${encodeURIComponent(token)}`;
      }
    },
    [token]
  );

  const handleJump = useCallback(
    (service: SsoServiceItem) => {
      if (!service.url) {
        message.warning('该服务暂无可用地址');
        return;
      }
      window.open(buildServiceUrl(service.url), '_blank', 'noopener,noreferrer');
    },
    [buildServiceUrl, message]
  );

  if (loading) return <Spin className="page-spin" />;

  // ─── Not logged in ────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', padding: '0 16px' }}>
        <Result
          icon={<SafetyCertificateOutlined style={{ color: '#1677ff' }} />}
          title="SSO 统一登录门户"
          subTitle="登录一次，访问所有服务"
          extra={[
            <Button
              key="login"
              type="primary"
              size="large"
              icon={<LoginOutlined />}
              onClick={() => navigate('/login')}
              block
            >
              登录
            </Button>,
          ]}
        />
      </div>
    );
  }

  // ─── Logged in ────────────────────────────────────────────────
  const onlineServices = services.filter((s) => s.status === 'online' || s.status === 'unknown');
  const offlineServices = services.filter((s) => s.status === 'offline' || s.status === 'maintenance');

  const ServiceCard = ({ svc }: { svc: SsoServiceItem }) => {
    const isOnline = svc.status === 'online' || svc.status === 'unknown';
    return (
      <Card
        hoverable={isOnline}
        style={{
          textAlign: 'center',
          minHeight: 120,
          opacity: isOnline ? 1 : 0.6,
          cursor: isOnline ? 'pointer' : 'default',
        }}
        onClick={() => isOnline && handleJump(svc)}
      >
        <Avatar
          size={48}
          style={{
            backgroundColor: isOnline ? '#1677ff' : '#d9d9d9',
            marginBottom: 8,
          }}
        >
          {svc.displayName.charAt(0)}
        </Avatar>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
          {svc.displayName}
        </div>
        <Space size={4}>
          <Tag style={{ fontSize: 10 }}>
            {svc.name}
          </Tag>
          <Tag
            color={isOnline ? 'success' : 'default'}
            style={{ fontSize: 10 }}
          >
            {isOnline ? '在线' : '离线'}
          </Tag>
          {token && isOnline && (
            <Tag color="blue" style={{ fontSize: 10 }}>
              SSO
            </Tag>
          )}
        </Space>
      </Card>
    );
  };

  return (
    <Space direction="vertical" size="large" className="page-stack" style={{ width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Typography.Title level={isMobile ? 4 : 3} style={{ margin: 0 }}>
            <SafetyCertificateOutlined /> SSO 统一门户
          </Typography.Title>
          <Typography.Text type="secondary">登录一次，跳转所有服务</Typography.Text>
        </div>
        <Space>
          <Typography.Text>
            {user?.name ?? '用户'}
          </Typography.Text>
          <Tag color="blue">{user?.role ?? '-'}</Tag>
          <Button
            size="small"
            icon={<LogoutOutlined />}
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            退出
          </Button>
        </Space>
      </div>

      {/* Status */}
      <Alert
        showIcon
        type="success"
        icon={<CheckCircleOutlined />}
        message={
          <Space>
            <span>已登录：{user?.name}（{user?.email}）</span>
            <Tag color="blue">Token 已就绪</Tag>
          </Space>
        }
        description="点击服务卡片可直接跳转。Token 将自动携带到目标服务，无需重复登录。"
      />

      {/* Stats */}
      <Row gutter={[16, 16]}>
        <Col xs={8}>
          <Card size="small">
            <div style={{ textAlign: 'center' }}>
              <Typography.Title level={2} style={{ margin: 0, color: '#1677ff' }}>
                {services.length}
              </Typography.Title>
              <Typography.Text type="secondary">已注册服务</Typography.Text>
            </div>
          </Card>
        </Col>
        <Col xs={8}>
          <Card size="small">
            <div style={{ textAlign: 'center' }}>
              <Typography.Title level={2} style={{ margin: 0, color: '#52c41a' }}>
                {onlineServices.length}
              </Typography.Title>
              <Typography.Text type="secondary">可跳转</Typography.Text>
            </div>
          </Card>
        </Col>
        <Col xs={8}>
          <Card size="small">
            <div style={{ textAlign: 'center' }}>
              <Typography.Title level={2} style={{ margin: 0, color: '#8c8c8c' }}>
                {offlineServices.length}
              </Typography.Title>
              <Typography.Text type="secondary">离线</Typography.Text>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Online services */}
      <Card
        title={
          <Space>
            <RocketOutlined />
            <span>可跳转服务</span>
          </Space>
        }
        extra={<Tag color="blue">{onlineServices.length} 个</Tag>}
      >
        {onlineServices.length === 0 ? (
          <Typography.Text type="secondary">暂无在线服务</Typography.Text>
        ) : (
          <Row gutter={[16, 16]}>
            {onlineServices.map((svc) => (
              <Col xs={12} sm={8} md={6} xl={4} key={svc.name}>
                <ServiceCard svc={svc} />
              </Col>
            ))}
          </Row>
        )}
      </Card>

      {/* Offline services */}
      {offlineServices.length > 0 && (
        <Card
          title={
            <Space>
              <ClockCircleOutlined />
              <span>离线服务</span>
            </Space>
          }
          extra={<Tag>{offlineServices.length} 个</Tag>}
        >
          <Row gutter={[16, 16]}>
            {offlineServices.map((svc) => (
              <Col xs={12} sm={8} md={6} xl={4} key={svc.name}>
                <ServiceCard svc={svc} />
              </Col>
            ))}
          </Row>
        </Card>
      )}

      {/* How it works */}
      <Card size="small" title="SSO 工作原理">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>在 Agent Dev Center 登录 → 获得 JWT Token</li>
            <li>点击服务卡片 → 自动携带 Token 跳转到目标服务</li>
            <li>目标服务验证 Token → 识别用户身份 → 自动登录</li>
            <li>Token 有效期内无需重复登录（Access Token: 2小时 / Refresh Token: 7天）</li>
          </ol>
        </Typography.Paragraph>
      </Card>
    </Space>
  );
}
