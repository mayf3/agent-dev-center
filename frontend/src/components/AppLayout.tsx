import {
  DashboardOutlined,
  LogoutOutlined,
  PlusCircleOutlined,
  ProjectOutlined,
  UnorderedListOutlined,
  CheckSquareOutlined,
  AppstoreOutlined,
  UserOutlined,
  MenuOutlined
} from '@ant-design/icons';
import { Button, Drawer, Layout, Menu, Space, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { roleLabels } from '../constants/options';
import { useAuth } from '../contexts/AuthContext';

const { Header, Content, Sider } = Layout;

const isPublicMode = import.meta.env.VITE_IS_PUBLIC_MODE === 'true';
const MOBILE_BREAKPOINT = 768;

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Responsive breakpoint detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const searchParamsHasMy = useCallback(() => {
    try {
      return new URLSearchParams(location.search).get('my') === '1';
    } catch {
      return false;
    }
  }, [location.search]);

  const selectedKey =
    location.pathname === '/'
      ? '/'
      : location.pathname.startsWith('/requirements/new')
        ? '/requirements/new'
        : location.pathname.startsWith('/requirements')
          ? searchParamsHasMy()
            ? '/requirements?my=1'
            : '/requirements'
          : location.pathname.startsWith('/kanban')
            ? '/kanban'
            : location.pathname.startsWith('/tasks/kanban')
              ? '/tasks/kanban'
              : location.pathname.startsWith('/tasks')
                ? '/tasks'
                : '/';

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key);
    setDrawerOpen(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('agent-dev-center-token');
    localStorage.removeItem('agent-dev-center-user');
    navigate('/login', { replace: true });
  };

  // Full menu items for sidebar / drawer
  const fullMenuItems: MenuProps['items'] = [
    { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/requirements', icon: <UnorderedListOutlined />, label: '需求列表' },
    { key: '/requirements?my=1', icon: <UserOutlined />, label: '我的任务' },
    ...(!isPublicMode ? [{ key: '/requirements/new', icon: <PlusCircleOutlined />, label: '提交需求' }] : []),
    { key: '/kanban', icon: <ProjectOutlined />, label: '开发看板' },
    { key: '/tasks', icon: <CheckSquareOutlined />, label: '任务列表' },
    { key: '/tasks/kanban', icon: <AppstoreOutlined />, label: '任务看板' },
  ];

  // Bottom tab bar items for mobile (limited to 5 key items)
  const bottomNavItems: { key: string; icon: React.ReactNode; label: string }[] = [
    { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/requirements', icon: <UnorderedListOutlined />, label: '需求' },
    { key: '/requirements?my=1', icon: <UserOutlined />, label: '我的' },
    { key: '/kanban', icon: <ProjectOutlined />, label: '看板' },
    { key: '/tasks', icon: <CheckSquareOutlined />, label: '任务' },
  ];

  // Bottom nav active key mapping
  const bottomNavActive = selectedKey === '/tasks/kanban' ? '/tasks'
    : selectedKey === '/requirements/new' ? '/requirements'
    : selectedKey;

  // Mobile Layout
  if (isMobile) {
    return (
      <Layout className="app-shell mobile-shell">
        <Header className="mobile-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Typography.Text strong style={{ color: '#1677ff', fontSize: 16 }}>🛠️ Dev Center</Typography.Text>
          </div>
          <Space size={8}>
            {user && (
              <>
                <Typography.Text style={{ color: '#333', fontSize: 13 }}>{user.name}</Typography.Text>
                <Button
                  type="text"
                  size="small"
                  icon={<MenuOutlined />}
                  onClick={() => setDrawerOpen(true)}
                />
              </>
            )}
          </Space>
        </Header>

        <Content className="mobile-content">
          <Outlet />
        </Content>

        {/* Bottom Navigation */}
        <nav className="mobile-bottom-nav">
          {bottomNavItems.map((item) => (
            <button
              key={item.key}
              className={`mobile-nav-item ${bottomNavActive === item.key ? 'active' : ''}`}
              onClick={() => navigate(item.key)}
            >
              <span className="mobile-nav-icon">{item.icon}</span>
              <span className="mobile-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Drawer for full menu */}
        <Drawer
          title="🛠️ Dev Center"
          placement="left"
          onClose={() => setDrawerOpen(false)}
          open={drawerOpen}
          width={260}
          extra={
            <Button type="text" icon={<LogoutOutlined />} onClick={handleLogout}>
              退出
            </Button>
          }
        >
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={fullMenuItems}
            onClick={handleMenuClick}
            style={{ border: 'none' }}
          />
        </Drawer>
      </Layout>
    );
  }

  // Desktop Layout (original)
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
          items={fullMenuItems}
          onClick={handleMenuClick}
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
