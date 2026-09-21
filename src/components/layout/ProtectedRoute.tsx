import { useEffect, useRef } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useOrg } from '../../hooks/useOrg';
import { SplashLoader } from '../branding/SplashLoader';
import { BigBubbles, BUBBLE_COVER_TOTAL_MS } from '../branding/BigBubbles';

/**
 * Blocks unauthenticated users; renders child routes once a session exists.
 * The splash -> login handoff isn't an instant redirect: once loading
 * resolves with no session, big bubbles grow to fully cover the screen,
 * THEN the route changes underneath them — Login.tsx picks up the same
 * transition (via location state) and shrinks the bubbles away to reveal
 * itself, so the cut never shows.
 */
export function ProtectedRoute() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const startedRef = useRef(false);

  useEffect(() => {
    if (loading || session || startedRef.current) return;
    startedRef.current = true;
    const t = setTimeout(() => {
      navigate('/login', { replace: true, state: { splashTransition: true } });
    }, BUBBLE_COVER_TOTAL_MS);
    return () => clearTimeout(t);
  }, [loading, session, navigate]);

  if (loading) return <SplashLoader />;
  if (!session) {
    return (
      <>
        <SplashLoader />
        <BigBubbles mode="cover" />
      </>
    );
  }
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
