import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { AuthCard, AuthLogoTile, AuthShell, BRAND_GRADIENT, BUTTON_SHADOW } from '../components/auth/AuthChrome';
import { FloatingField } from '../components/auth/FloatingField';
import { EyeToggle } from '../components/auth/EyeToggle';
import { ArrowIcon } from '../components/auth/icons';
import { SplashLoader, SPLASH_LOOP_MS } from '../components/branding/SplashLoader';
import { BigBubbles, BUBBLE_COVER_TOTAL_MS, BUBBLE_REVEAL_HOLD_MS, BUBBLE_REVEAL_MS } from '../components/branding/BigBubbles';

/** The same brand intro the sign-in page gets: splash, bubbles cover the screen, then shrink away to reveal the page. */
type Intro = 'splash' | 'cover' | 'reveal' | 'done';

/** Landing page for invite links: the invitee sets their password here, on the same branded screen as sign-in. */
export function Welcome() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [intro, setIntro] = useState<Intro>('splash');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setIntro('cover'), SPLASH_LOOP_MS));
    timers.push(setTimeout(() => setIntro('reveal'), SPLASH_LOOP_MS + BUBBLE_COVER_TOTAL_MS));
    timers.push(setTimeout(() => setIntro('done'), SPLASH_LOOP_MS + BUBBLE_COVER_TOTAL_MS + BUBBLE_REVEAL_HOLD_MS + BUBBLE_REVEAL_MS));
    return () => timers.forEach(clearTimeout);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (err) setError(err.message);
    else navigate('/', { replace: true });
  }

  // Hold the splash until both the intro has played and the invite link has been read.
  if (intro === 'splash' || (loading && intro !== 'done')) return <SplashLoader />;
  if (intro === 'cover') return <><SplashLoader /><BigBubbles mode="cover" /></>;

  return (
    <>
      <AuthShell>
        <AuthCard>
          <div className="px-8 pb-5 pt-7 text-center sm:px-10">
            <AuthLogoTile size={48} />
            <h1 className="mt-4 text-[25px] font-extrabold tracking-tight text-offwhite">Welcome to Dreamlabs Sales</h1>
            <p className="mt-1 text-[14px] text-muted">
              {session ? 'Set a password to finish creating your account.' : 'Open the link in your invitation email to get started.'}
            </p>
          </div>
          <div className="px-8 pb-7 sm:px-10">
            {session ? (
              <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
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
                {error && <p role="alert" className="text-sm text-danger">{error}</p>}
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-on-accent transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
                  style={{ background: BRAND_GRADIENT, boxShadow: BUTTON_SHADOW }}
                >
                  {submitting && <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden />}
                  {submitting ? 'Saving…' : 'Set password and enter'}
                  {!submitting && <ArrowIcon />}
                </button>
              </form>
            ) : (
              <div className="flex flex-col gap-4 text-center">
                <p className="text-sm text-muted">
                  This page is for invite links. If your link has expired, ask the person who invited you to send a new one.
                </p>
                <Link to="/login" className="text-sm font-semibold text-link hover:text-violet/80">Go to sign in</Link>
              </div>
            )}
          </div>
        </AuthCard>
      </AuthShell>
      {intro === 'reveal' && <BigBubbles mode="reveal" />}
    </>
  );
}
