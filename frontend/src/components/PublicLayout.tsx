import {
  DashboardOutlined,
  EyeOutlined,
  LoginOutlined,
  ProjectOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import { Alert, Button, Layout, Menu, Space, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AppLayout } from './AppLayout';

const { Header, Content, Sider } = Layout;

export function PublicLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  // 已登录用户直接渲染 AppLayout（带完整导航和功能）
  if (isAuthenticated) {
    return <AppLayout />;
  }

  const menuItems: MenuProps['items'] = [
    {
      key: '/',
      icon: <DashboardOutlined />,
      label: '仪表盘'
    },
    {
      key: '/requirements',
      icon: <UnorderedListOutlined />,
      label: '需求列表'
    },
    {
      key: '/kanban',
      icon: <ProjectOutlined />,
      label: '开发看板'
    }
  ];

  const selectedKey =
    location.pathname === '/'
      ? '/'
      : location.pathname.startsWith('/requirements')
        ? '/requirements'
        : location.pathname.startsWith('/kanban')
          ? '/kanban'
          : '/';

  return (
    <Layout className="app-shell">
      <Sider breakpoint="lg" collapsedWidth="0" className="app-sider">
        <div className="brand">
          <span className="brand-mark">A</span>
          <span className="brand-name">Agent开发中心</span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Typography.Title level={4} className="page-title">
            Agent开发中心
          </Typography.Title>
          <Space size="middle">
            <Space size={4}>
              <EyeOutlined />
              <span className="user-name">只读模式</span>
            </Space>
            <Button icon={<LoginOutlined />} type="primary" onClick={() => navigate('/login')}>
              登录
            </Button>
          </Space>
        </Header>
        <Content className="app-content">
          <Alert
            message="只读模式"
            description="您正在以只读模式浏览。登录后可提交需求和管理看板。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
