import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
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
  const { profile, loading } = useAuth();
  if (loading) return null;
  if (profile?.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}
