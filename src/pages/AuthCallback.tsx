import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Skeleton } from '../components/ui/Skeleton';

/**
 * Landing page for the Google OAuth redirect. Guardrail: a Google sign-in
 * only succeeds if the resulting account already has at least one
 * org_members row — this app is invite-only, Google Sign-In is just a login
 * method, never a self-registration path.
 */
export function AuthCallback() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'checking' | 'denied'>('checking');

  useEffect(() => {
    if (loading || !session) return;
    let cancelled = false;
    void supabase
      .from('org_members').select('id', { count: 'exact', head: true }).eq('user_id', session.user.id)
      .then(async ({ count }) => {
        if (cancelled) return;
        if (!count) {
          await supabase.auth.signOut();
          setStatus('denied');
        } else {
          navigate('/', { replace: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, loading, navigate]);

  if (status === 'denied') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl border border-line bg-card p-8 text-center">
          <h1 className="mb-2 text-[18px] font-bold">Not invited yet</h1>
          <p className="text-sm text-muted">
            This Google account hasn't been invited to Dreamlabs Sales. Ask your organization's
            admin to send you an invite, then try again.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Skeleton className="h-24 w-72" />
    </div>
  );
}
