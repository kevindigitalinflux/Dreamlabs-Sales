import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useOrg } from '../../hooks/useOrg';
import { SplashLoader, SPLASH_LOOP_MS } from '../branding/SplashLoader';
import { BigBubbles, BUBBLE_COVER_TOTAL_MS } from '../branding/BigBubbles';

/**
 * Blocks unauthenticated users; renders child routes once a session exists.
 * For a signed-out visitor the splash is a deliberate brand intro, not just
 * a spinner — it always plays its full loop (auth resolves almost instantly
 * in the common case, well before that), THEN big bubbles grow to fully
 * cover the screen and the route changes underneath them — Login.tsx picks
 * up the same transition (via location state) and shrinks the bubbles away
 * to reveal itself, so the cut never shows. An already-authenticated user
 * (the common return-visit case) skips all of this and loads straight in.
 */
export function ProtectedRoute() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const startedRef = useRef(false);
  const [showBubbles, setShowBubbles] = useState(false);

  useEffect(() => {
    if (loading || session || startedRef.current) return;
    startedRef.current = true;
    const t = setTimeout(() => setShowBubbles(true), SPLASH_LOOP_MS);
    return () => clearTimeout(t);
  }, [loading, session]);

  useEffect(() => {
    if (!showBubbles) return;
    const t = setTimeout(() => {
      navigate('/login', { replace: true, state: { splashTransition: true } });
    }, BUBBLE_COVER_TOTAL_MS);
    return () => clearTimeout(t);
  }, [showBubbles, navigate]);

  if (loading) return <SplashLoader />;
  if (!session) {
    return (
      <>
        <SplashLoader />
        {showBubbles && <BigBubbles mode="cover" />}
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
