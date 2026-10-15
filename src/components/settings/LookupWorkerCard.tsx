import { useState } from 'react';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

export function LookupWorkerCard({ configured, shared, host, onSave, onRemove }: {
  configured: boolean; shared: boolean; host: string | null;
  onSave(value: string): Promise<string | null>; onRemove(): Promise<string | null>;
}) {
  const [address, setAddress] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(remove: boolean) {
    setBusy(true); setMessage(null);
    try {
      const error = remove ? await onRemove() : await onSave(`${address.trim()}|${secret.trim()}`);
      setMessage(error ?? (remove ? 'Worker connection removed.' : 'Worker connection verified and saved.'));
      if (!error) { setAddress(''); setSecret(''); }
    } catch {
      console.error('settings: worker connection could not be saved');
      setMessage('Could not update the worker connection. Try again.');
    } finally { setBusy(false); }
  }
  return <Card><div className="flex min-w-0 flex-col gap-3">
    <h2 className="text-lg font-bold">Lookup worker</h2>
    <p className="break-words text-sm">{configured ? `Using your own worker${host ? ` (${host})` : ''}` : shared ? 'Using the shared worker' : 'Not set up'}</p>
    <Input label="Worker address" type="url" autoComplete="off" placeholder="https://worker.example.com"
      value={address} onChange={(e) => setAddress(e.target.value)} disabled={busy} />
    <Input label="Worker secret" type="password" autoComplete="new-password" value={secret}
      onChange={(e) => setSecret(e.target.value)} disabled={busy} />
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void submit(false)} disabled={busy || !address.trim() || !secret.trim()} loading={busy}>Save</Button>
      {configured && <Button variant="secondary" onClick={() => void submit(true)} disabled={busy}>Remove</Button>}
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </div></Card>;
}
