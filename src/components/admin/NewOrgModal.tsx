import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';

interface NewOrgModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (org: { id: string; name: string }) => void;
}

/** Platform-admin-only: create a brand new organization. */
export function NewOrgModal({ open, onClose, onCreated }: NewOrgModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('admin-users', { body: { action: 'create_org', name } });
    setSubmitting(false);
    const apiError = err?.message ?? (data as { error?: string } | null)?.error;
    if (apiError) return setError(apiError);
    const org = (data as { org: { id: string; name: string } }).org;
    setName('');
    onCreated(org);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="New organization">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Organization name" value={name} onChange={(e) => setName(e.target.value)} required />
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create organization'}</Button>
      </form>
    </Modal>
  );
}
