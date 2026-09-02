import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useOrg } from '../../hooks/useOrg';
import { Skeleton } from '../ui/Skeleton';

/** Blocks unauthenticated users; renders child routes once a session exists. */
export function ProtectedRoute() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-24 w-72" />
      </div>
    );
  }
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
