import {
  DashboardOutlined,
  LogoutOutlined,
  PlusCircleOutlined,
  ProjectOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import { Button, Layout, Menu, Space, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { roleLabels } from '../constants/options';
import { useAuth } from '../contexts/AuthContext';

const { Header, Content, Sider } = Layout;

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

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
      key: '/requirements/new',
      icon: <PlusCircleOutlined />,
      label: '提交需求'
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
      : location.pathname.startsWith('/requirements/new')
        ? '/requirements/new'
        : location.pathname.startsWith('/requirements')
          ? '/requirements'
          : location.pathname.startsWith('/kanban')
            ? '/kanban'
            : '/';

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

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
            {user ? (
              <Space size={8}>
                <span className="user-name">{user.name}</span>
                <Tag color="blue">{roleLabels[user.role]}</Tag>
              </Space>
            ) : null}
            <Button icon={<LogoutOutlined />} onClick={handleLogout}>
              退出
            </Button>
          </Space>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
