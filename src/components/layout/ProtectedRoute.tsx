import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useOrg } from '../../hooks/useOrg';
import { SplashLoader } from '../branding/SplashLoader';

/** Blocks unauthenticated users; renders child routes once a session exists. */
export function ProtectedRoute() {
  const { session, loading } = useAuth();
  if (loading) return <SplashLoader />;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Blocks non-admins (UX only — RLS is the real boundary). */
export function AdminRoute() {
  const { loading: authLoading } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  if (authLoading || orgLoading) return null;
  if (currentOrg?.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}
