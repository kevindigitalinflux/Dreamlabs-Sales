import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

/** Landing page for invite links: the invitee sets their password here. */
export function Welcome() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setSubmitting(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (err) setError(err.message);
    else navigate('/', { replace: true });
  }

  if (loading) return null;
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl border border-line bg-card p-8">
        <h1 className="mb-1 text-[22px] font-bold">Welcome to Dreamlabs Sales</h1>
        {session ? (
          <>
            <p className="mb-6 text-sm text-muted">Set a password to finish creating your account.</p>
            <div className="flex flex-col gap-4">
              <Input label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
              <Input label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
              {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? 'Saving…' : 'Set password & enter'}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">
            This page is for invite links. Open the link from your invitation email again — if it has expired, ask Kevin to re-invite you.
          </p>
        )}
      </form>
    </div>
  );
}
