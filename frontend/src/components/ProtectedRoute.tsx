import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const isPublicMode = import.meta.env.VITE_IS_PUBLIC_MODE === 'true';

export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // 公开模式下，未登录用户走 PublicLayout，不需要重定向到登录页
    // 只有需要编辑权限的页面（如 /requirements/new）才重定向
    if (isPublicMode) {
      if (location.pathname === '/requirements/new') {
        return <Navigate to="/login" replace state={{ from: location }} />;
      }
      // 其他页面由 PublicLayout 处理只读展示
      return <Navigate to="/" replace />;
    }
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
