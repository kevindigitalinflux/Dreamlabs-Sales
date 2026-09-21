import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { supabase } from '../lib/supabase';
import { AuthCard, AuthLogoTile, AuthShell, BRAND_GRADIENT, BUTTON_SHADOW } from '../components/auth/AuthChrome';
import { FloatingField } from '../components/auth/FloatingField';
import { ArrowIcon } from '../components/auth/icons';

/** Requests a Supabase password-reset email; the link lands on ResetPassword. */
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (err) setError(err.message);
    else setSent(true);
  }

  return (
    <AuthShell>
      <AuthCard>
        <div className="px-8 pb-5 pt-7 text-center sm:px-10">
          <AuthLogoTile size={48} />
          <h1 className="mt-4 text-[25px] font-extrabold tracking-tight text-offwhite">Reset your password</h1>
          <p className="mt-1 text-[14px] text-muted">
            {sent ? "We've sent a reset link to your email." : "Enter your email and we'll send you a reset link."}
          </p>
        </div>

        <div className="px-8 pb-7 sm:px-10">
          {sent ? (
            <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
              Check <span className="font-semibold text-offwhite">{email}</span> for a link to choose a new password. It'll expire soon, so use it
              promptly.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <FloatingField id="email" label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email" required />

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
                {submitting ? 'Sending…' : 'Send reset link'}
                {!submitting && <ArrowIcon />}
              </button>
            </form>
          )}

          <Link to="/login" className="mt-6 block text-center text-sm font-semibold text-violet hover:text-violet/80">
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
