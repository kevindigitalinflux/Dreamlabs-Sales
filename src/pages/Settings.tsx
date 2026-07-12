import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';

/** Profile settings: display name. Email SMTP config arrives in cycle 2. */
export function Settings() {
  const { profile } = useAuth();
  const [fullName, setFullName] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setFullName(profile?.full_name ?? '');
  }, [profile]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setStatus('saving');
    const { error } = await supabase.from('profiles').update({ full_name: fullName }).eq('id', profile.id);
    setStatus(error ? 'error' : 'saved');
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-[28px] font-extrabold">Settings</h1>
      <Card>
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <h2 className="text-[18px] font-bold">Profile</h2>
          <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Save'}
            </Button>
            {status === 'saved' && <span className="text-sm text-green-400">Saved ✓</span>}
            {status === 'error' && <span role="alert" className="text-sm text-red-400">Could not save — try again.</span>}
          </div>
        </form>
      </Card>
      <Card>
        <h2 className="mb-1 text-[18px] font-bold">Email sending</h2>
        <p className="text-sm text-muted">SMTP configuration arrives with the Email Automation module in the next build cycle.</p>
      </Card>
    </div>
  );
}
