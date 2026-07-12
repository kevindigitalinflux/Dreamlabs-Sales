import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  onInvited: () => void;
}

/** Sends a contractor invite via the admin-users Edge Function. */
export function InviteModal({ open, onClose, onInvited }: InviteModalProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('admin-users', {
      body: {
        action: 'invite',
        email,
        full_name: fullName,
        redirect_to: `${window.location.origin}/welcome`,
      },
    });
    setSubmitting(false);
    const apiError = err?.message ?? (data as { error?: string } | null)?.error;
    if (apiError) return setError(apiError);
    setFullName('');
    setEmail('');
    onInvited();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Invite contractor">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send invite'}
        </Button>
      </form>
    </Modal>
  );
}
