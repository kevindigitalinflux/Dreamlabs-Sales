import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { AuthCard, AuthLogoTile, AuthShell, BRAND_GRADIENT, BUTTON_SHADOW } from '../components/auth/AuthChrome';
import { FloatingField } from '../components/auth/FloatingField';
import { EyeToggle } from '../components/auth/EyeToggle';
import { ArrowIcon, GoogleIcon, ShieldIcon } from '../components/auth/icons';
import { BigBubbles, BUBBLE_REVEAL_HOLD_MS, BUBBLE_REVEAL_MS } from '../components/branding/BigBubbles';

/** Email + password sign-in. No self-registration — accounts are invite-only. */
export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Arrived via the splash loader's bubble-wipe transition (ProtectedRoute
  // sets this in navigate() state right as the bubbles finish covering the
  // screen) — start already fully covered and shrink the bubbles away to
  // reveal this page, instead of an abrupt cut.
  const cameFromSplash = (location.state as { splashTransition?: boolean } | null)?.splashTransition === true;
  const [revealing, setRevealing] = useState(cameFromSplash);

  useEffect(() => {
    if (!cameFromSplash) return;
    const t = setTimeout(() => setRevealing(false), BUBBLE_REVEAL_HOLD_MS + BUBBLE_REVEAL_MS);
    return () => clearTimeout(t);
  }, [cameFromSplash]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const err = await signIn(email, password);
    setSubmitting(false);
    if (err) setError(err);
    else navigate('/', { replace: true });
  }

  /** Kicks off the Google OAuth redirect flow; AuthCallback enforces invite-only access. */
  async function handleGoogleSignIn() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <>
      <AuthShell>
        <AuthCard>
          <div className="px-8 pb-5 pt-7 text-center sm:px-10">
            <AuthLogoTile size={48} />
            <h1 className="mt-4 text-[25px] font-extrabold tracking-tight text-offwhite">Welcome back</h1>
            <p className="mt-1 text-[14px] text-muted">Sign in to your Dreamlabs Sales workspace.</p>
          </div>

          <div className="px-8 pb-7 sm:px-10">
            <button
              type="button"
              onClick={() => void handleGoogleSignIn()}
              className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-card text-[14px] font-semibold text-offwhite transition-colors hover:border-muted/50 hover:bg-surface"
            >
              <GoogleIcon />
              Continue with Google
            </button>

            <div className="my-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">or with email</span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
              <FloatingField id="email" label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email" required />
              <FloatingField
                id="password"
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                required
                trailing={<EyeToggle shown={showPassword} onToggle={() => setShowPassword((s) => !s)} />}
              />

              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-between pt-0.5">
                <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="sr-only" />
                  <span
                    className={`flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border-2 transition-colors ${
                      remember ? 'border-violet bg-violet' : 'border-line bg-card'
                    }`}
                  >
                    {remember && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                  Remember me
                </label>
                <Link to="/forgot-password" className="text-sm font-semibold text-violet hover:text-violet/80">
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-on-accent transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: BRAND_GRADIENT, boxShadow: BUTTON_SHADOW }}
              >
                {submitting ? 'Signing in…' : 'Sign in'}
                {!submitting && <ArrowIcon />}
              </button>
            </form>
          </div>
        </AuthCard>

        <p className="mx-auto mt-4 max-w-[20rem] text-center text-xs text-nav-muted">
          <ShieldIcon />
          Protected by Dreamlabs Sales security. By continuing you agree to our <span className="underline decoration-white/30">Terms</span>.
        </p>
      </AuthShell>

      {revealing && <BigBubbles mode="reveal" />}
    </>
  );
}
