import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { supabase } from '../lib/supabase';
import { AuthCard, AuthLogoTile, AuthShell, BRAND_GRADIENT, BUTTON_SHADOW } from '../components/auth/AuthChrome';
import { FloatingField } from '../components/auth/FloatingField';
import { EyeToggle } from '../components/auth/EyeToggle';
import { ArrowIcon } from '../components/auth/icons';

/**
 * Landing page for a Supabase password-reset email link. Clicking that link
 * makes supabase-js set a recovery session automatically (detectSessionInUrl,
 * on by default) and fire a PASSWORD_RECOVERY auth event — this page waits
 * for that before showing the new-password form.
 */
export function ResetPassword() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY' || session) {
        setReady(true);
        setChecking(false);
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) setReady(true);
      setChecking(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (err) setError(err.message);
    else navigate('/', { replace: true });
  }

  return (
    <AuthShell>
      <AuthCard>
        <div className="px-8 pb-7 pt-9 text-center sm:px-10">
          <AuthLogoTile />
          <h1 className="mt-5 text-[27px] font-extrabold tracking-tight text-offwhite">Choose a new password</h1>
          <p className="mt-1.5 text-[14.5px] text-muted">Make it something you haven't used before.</p>
        </div>

        <div className="px-8 pb-9 sm:px-10">
          {checking ? (
            <p className="text-center text-sm text-muted">Checking your reset link…</p>
          ) : !ready ? (
            <div className="flex flex-col gap-4 text-center">
              <p className="text-sm text-danger">This reset link is invalid or has expired.</p>
              <Link to="/forgot-password" className="text-sm font-semibold text-violet hover:text-violet/80">
                Request a new link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <FloatingField
                id="password"
                label="New password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                required
                minLength={8}
                trailing={<EyeToggle shown={showPassword} onToggle={() => setShowPassword((s) => !s)} />}
              />
              <FloatingField
                id="confirm"
                label="Confirm password"
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                required
                minLength={8}
              />

              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-on-accent transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: BRAND_GRADIENT, boxShadow: BUTTON_SHADOW }}
              >
                {submitting ? 'Saving…' : 'Save new password'}
                {!submitting && <ArrowIcon />}
              </button>
            </form>
          )}
        </div>
      </AuthCard>
    </AuthShell>
  );
}
