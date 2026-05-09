import { ConfigProvider, App as AntApp } from 'antd';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './contexts/AuthContext';
import { DashboardPage } from './pages/DashboardPage';
import { KanbanBoardPage } from './pages/KanbanBoardPage';
import { LoginPage } from './pages/LoginPage';
import { RequirementDetailPage } from './pages/RequirementDetailPage';
import { RequirementListPage } from './pages/RequirementListPage';
import { SubmitRequirementPage } from './pages/SubmitRequirementPage';

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    path: '/register',
    element: <LoginPage />
  },
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
