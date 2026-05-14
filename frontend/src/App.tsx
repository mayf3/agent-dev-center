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
import { TaskListPage } from './pages/TaskListPage';
import { TaskKanbanPage } from './pages/TaskKanbanPage';
import { ServicesPage } from './pages/ServicesPage';
import { ServiceDetailPage } from './pages/ServiceDetailPage';
import { lazy, Suspense } from 'react';
import { Spin } from 'antd';

const MarketplacePage = lazy(() => import('./pages/marketplace/MarketplacePage').then(m => ({ default: m.MarketplacePage })));

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
  // 注意：必须放在 ProtectedRoute 之后，否则已登录用户会被 PublicLayout 抢先匹配
  ...(isPublicMode
    ? [
        {
          path: '/',
          element: <PublicLayout />,
          children: [
            { index: true, element: <DashboardPage /> },
            { path: 'requirements', element: <RequirementListPage /> },
            { path: 'requirements/:id', element: <RequirementDetailPage /> },
            { path: 'kanban', element: <KanbanBoardPage /> },
            { path: 'services', element: <ServicesPage /> },
            { path: 'services/:id', element: <ServiceDetailPage /> },
            { path: 'tasks', element: <TaskListPage /> },
            { path: 'tasks/kanban', element: <TaskKanbanPage /> },
            { path: 'marketplace', element: <Suspense fallback={<Spin className="page-spin" />}><MarketplacePage /></Suspense> }
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
          },
          {
            path: 'services',
            element: <ServicesPage />
          },
          {
            path: 'services/:id',
            element: <ServiceDetailPage />
          },
          {
            path: 'tasks',
            element: <TaskListPage />
          },
          {
            path: 'tasks/kanban',
            element: <TaskKanbanPage />
          },
          {
            path: 'marketplace',
            element: <Suspense fallback={<Spin className="page-spin" />}><MarketplacePage /></Suspense>
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
