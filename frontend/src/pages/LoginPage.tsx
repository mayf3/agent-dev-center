import { LockOutlined, MailOutlined, SafetyOutlined, UserOutlined } from '@ant-design/icons';
import {
  App as AntApp,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Tabs,
  Typography
} from 'antd';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { UserRole } from '../api/types';
import { roleLabels } from '../constants/options';
import { useAuth } from '../contexts/AuthContext';

interface LoginValues {
  email: string;
  password: string;
}

interface RegisterValues extends LoginValues {
  name: string;
  role: UserRole;
}

interface TokenLoginValues {
  token: string;
}

const isPublic = import.meta.env.VITE_IS_PUBLIC === 'true';
const isPublicMode = import.meta.env.VITE_IS_PUBLIC_MODE === 'true';
const enableRegistration = import.meta.env.VITE_ENABLE_REGISTRATION !== 'false';

export function LoginPage() {
  const { login, register, loginWithToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';
  const activeTab = location.pathname === '/register' && !isPublic && enableRegistration ? 'register' : 'login';

  const afterAuth = () => {
    navigate(from, { replace: true });
  };

  const handleLogin = async (values: LoginValues) => {
    setLoading(true);
    try {
      await login(values);
      afterAuth();
    } catch (error) {
      message.error((error as Error).message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values: RegisterValues) => {
    setLoading(true);
    try {
      await register(values);
      afterAuth();
    } catch (error) {
      message.error((error as Error).message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  const handleTokenLogin = async (values: TokenLoginValues) => {
    setLoading(true);
    try {
      await loginWithToken(values.token);
      afterAuth();
    } catch (error) {
      message.error((error as Error).message || 'Token 登录失败');
    } finally {
      setLoading(false);
    }
  };

  const tabItems = [];

  // 登录 Tab
  tabItems.push({
    key: 'login',
    label: '登录',
    children: isPublicMode || isPublic ? (
      /* 外网/生产模式：Token 快速登录 */
      <Form layout="vertical" requiredMark={false} onFinish={handleTokenLogin}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          请输入管理员 Token 以访问系统
        </Typography.Paragraph>
        <Form.Item
          name="token"
          rules={[{ required: true, message: '请输入管理员 Token' }]}
        >
          <Input.Password
            prefix={<SafetyOutlined />}
            placeholder="输入管理员 Token"
          />
        </Form.Item>
        <Button block type="primary" htmlType="submit" loading={loading}>
          Token 登录
        </Button>
      </Form>
    ) : (
      /* 内网：邮箱密码登录 */
      <Form layout="vertical" requiredMark={false} onFinish={handleLogin}>
        <Form.Item
          label="邮箱"
          name="email"
          rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}
        >
          <Input prefix={<MailOutlined />} placeholder="name@example.com" />
        </Form.Item>
        <Form.Item
          label="密码"
          name="password"
          rules={[{ required: true, message: '请输入密码' }]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="至少 8 位" />
        </Form.Item>
        <Button block type="primary" htmlType="submit" loading={loading}>
          登录
        </Button>
      </Form>
    )
  });

  // 注册 Tab（仅内网且未禁用注册时显示）
  if (!isPublic && !isPublicMode && enableRegistration) {
    tabItems.push({
      key: 'register',
      label: '注册',
      children: (
        <Form
          layout="vertical"
          requiredMark={false}
          initialValues={{ role: 'requester' }}
          onFinish={handleRegister}
        >
          <Form.Item
            label="姓名"
            name="name"
            rules={[{ required: true, min: 2, message: '请输入姓名' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="你的姓名或 Agent 名称" />
          </Form.Item>
          <Form.Item
            label="邮箱"
            name="email"
            rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}
          >
            <Input prefix={<MailOutlined />} placeholder="name@example.com" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, min: 8, message: '密码至少 8 位' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="至少 8 位" />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(roleLabels) as UserRole[]).map((role) => ({
                label: roleLabels[role],
                value: role
              }))}
            />
          </Form.Item>
          <Button block type="primary" htmlType="submit" loading={loading}>
            注册并进入
          </Button>
        </Form>
      )
    });
  }

  return (
    <div className="login-page">
      <Card className="login-card">
        <Space direction="vertical" size={4} className="login-title">
          <Typography.Title level={2}>Agent开发中心</Typography.Title>
          <Typography.Text type="secondary">需求驱动的开发管理平台</Typography.Text>
        </Space>

        <Tabs
          centered
          activeKey={activeTab}
          onChange={(key) => navigate(key === 'register' ? '/register' : '/login', { replace: true })}
          items={tabItems}
        />
      </Card>
    </div>
  );
}
