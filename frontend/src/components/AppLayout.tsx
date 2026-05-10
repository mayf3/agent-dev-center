import {
  DashboardOutlined,
  LogoutOutlined,
  PlusCircleOutlined,
  ProjectOutlined,
  UnorderedListOutlined,
  CheckSquareOutlined,
  AppstoreOutlined
} from '@ant-design/icons';
import { Button, Layout, Menu, Space, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { roleLabels } from '../constants/options';
import { useAuth } from '../contexts/AuthContext';

const { Header, Content, Sider } = Layout;

const isPublic = import.meta.env.VITE_IS_PUBLIC === 'true';
const isPublicMode = import.meta.env.VITE_IS_PUBLIC_MODE === 'true';

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
    ...(!isPublic && !isPublicMode
      ? [
          {
            key: '/requirements/new',
            icon: <PlusCircleOutlined />,
            label: '提交需求'
          }
        ]
      : []),
    {
      key: '/kanban',
      icon: <ProjectOutlined />,
      label: '开发看板'
    },
    {
      key: '/tasks',
      icon: <CheckSquareOutlined />,
      label: '任务列表'
    },
    {
      key: '/tasks/kanban',
      icon: <AppstoreOutlined />,
      label: '任务看板'
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
            : location.pathname.startsWith('/tasks/kanban')
              ? '/tasks/kanban'
              : location.pathname.startsWith('/tasks')
                ? '/tasks'
                : '/';

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <Layout className="app-shell">
      <Sider breakpoint="lg" collapsedWidth="0" className="app-sider">
        <div className="app-logo">
          <Typography.Title level={4} style={{ margin: 0, color: '#fff' }}>
            🛠️ Dev Center
          </Typography.Title>
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
          <Space size="middle">
            {user && (
              <>
                <Typography.Text style={{ color: '#fff' }}>
                  👤 {user.name}
                </Typography.Text>
                <Tag>{roleLabels[user.role]}</Tag>
              </>
            )}
            {user && (
              <Button icon={<LogoutOutlined />} onClick={handleLogout}>
                退出
              </Button>
            )}
          </Space>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
