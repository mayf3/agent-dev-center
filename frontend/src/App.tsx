import { ConfigProvider, App as AntApp } from 'antd';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { PublicLayout } from './components/PublicLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './contexts/AuthContext';
import { DashboardPage } from './pages/DashboardPage';
import { KanbanBoardPage } from './pages/KanbanBoardPage';
import { LoginPage } from './pages/LoginPage';
import { RequirementDetailPage } from './pages/RequirementDetailPage';
import { RequirementListPage } from './pages/RequirementListPage';
import { SubmitRequirementPage } from './pages/SubmitRequirementPage';

const isPublicMode = import.meta.env.VITE_IS_PUBLIC_MODE === 'true';

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />
  },
  // 生产模式下 /register 路由重定向到 /login
  ...(!isPublicMode
    ? [{ path: '/register', element: <LoginPage /> }]
    : [{ path: '/register', element: <LoginPage /> }]),
  // 公开只读路由（未登录也能访问需求列表/看板）
  ...(isPublicMode
    ? [
        {
          path: '/',
          element: <PublicLayout />,
          children: [
            { index: true, element: <DashboardPage /> },
            { path: 'requirements', element: <RequirementListPage /> },
            { path: 'requirements/:id', element: <RequirementDetailPage /> },
            { path: 'kanban', element: <KanbanBoardPage /> }
          ]
        }
      ]
    : []),
  // 已登录用户完整路由
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: <DashboardPage />
          },
          {
            path: 'requirements',
            element: <RequirementListPage />
          },
          {
            path: 'requirements/new',
            element: <SubmitRequirementPage />
          },
          {
            path: 'requirements/:id',
            element: <RequirementDetailPage />
          },
          {
            path: 'kanban',
            element: <KanbanBoardPage />
          }
        ]
      }
    ]
  }
]);

export function App() {
  return (
    <ConfigProvider
      theme={{
        cssVar: true,
        token: {
          borderRadius: 8,
          colorPrimary: '#1677ff',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
        }
      }}
    >
      <AntApp>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </AntApp>
    </ConfigProvider>
  );
}
