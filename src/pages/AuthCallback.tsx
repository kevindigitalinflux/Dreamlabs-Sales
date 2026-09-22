import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { SplashLoader } from '../components/branding/SplashLoader';

/**
 * Landing page for the Google OAuth redirect. Guardrail: a Google sign-in
 * only succeeds if the resulting account already has at least one
 * org_members row — this app is invite-only, Google Sign-In is just a login
 * method, never a self-registration path.
 */
export function AuthCallback() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'checking' | 'denied' | 'error'>('checking');

  useEffect(() => {
    if (loading || !session) return;
    let cancelled = false;
    // Without this failure path, a rejected promise (network failure, a
    // PostgREST-level error, or the signOut() call itself failing) would
    // leave `status` stuck on 'checking' forever — the splash screen
    // spinning with no way out. Supabase's query builder is thenable, not a
    // full Promise (no .catch()), so the rejection handler is passed as
    // .then()'s second argument; that only catches the query itself
    // rejecting, not an error thrown inside the first (async) callback, so
    // that callback also gets its own try/catch funneling into the same
    // handler.
    const handleFailure = (err: unknown) => {
      if (cancelled) return;
      console.error('Failed to verify org membership:', err);
      setStatus('error');
    };
    void supabase
      .from('org_members').select('id', { count: 'exact', head: true }).eq('user_id', session.user.id)
      .then(async ({ count, error }) => {
        if (cancelled) return;
        try {
          if (error) throw error;
          if (!count) {
            await supabase.auth.signOut();
            setStatus('denied');
          } else {
            navigate('/', { replace: true });
          }
        } catch (err) {
          handleFailure(err);
        }
      }, handleFailure);
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
  if (status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl border border-line bg-card p-8 text-center">
          <h1 className="mb-2 text-[18px] font-bold">Something went wrong</h1>
          <p className="mb-4 text-sm text-muted">
            We couldn't finish signing you in. Please try again.
          </p>
          <a href="/login" className="text-sm font-semibold text-violet hover:text-violet/80">
            Back to sign in
          </a>
        </div>
      </div>
    );
  }
  return <SplashLoader />;
}
