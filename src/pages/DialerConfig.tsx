import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useDialerSettings } from '../hooks/useDialerSettings';
import type { DialerSaveInput } from '../hooks/useDialerSettings';
import type { DialerProvider } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, SelectField } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';

const PROVIDER_LABELS: Record<DialerProvider, string> = {
  justcall: 'JustCall',
  kixie: 'Kixie',
  aircall: 'Aircall',
};

/** Per-contractor power dialer connection (calling-integration spec §3). No live key validation yet — that lands once a provider is chosen. */
export function DialerConfig() {
  const { settings, loading, error, save } = useDialerSettings();
  const [form, setForm] = useState<DialerSaveInput>({ provider: 'justcall', phone_number: '', api_key: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (settings) {
      setForm((f) => ({ ...f, provider: settings.provider, phone_number: settings.phone_number ?? '' }));
    }
  }, [settings]);

  async function handleSave() {
    setBusy(true); setMsg(null);
    const err = await save(form);
    setBusy(false);
    setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Settings saved.' });
    if (!err) setForm((f) => ({ ...f, api_key: '' }));
  }

  if (loading) return <Skeleton className="h-80 w-full max-w-2xl" />;

  if (error) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <h1 className="text-[28px] font-extrabold">Power dialer</h1>
        <Card>
          <p role="alert" className="text-sm text-danger">Could not load your dialer settings — {error}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <header className="flex items-center gap-3">
        <h1 className="text-[28px] font-extrabold">Power dialer</h1>
        {settings?.is_verified && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Verified
          </span>
        )}
      </header>
      <p className="text-muted">
        Connect your dialer account so calls, recordings, and outcomes attach to the right lead automatically.
        Connection testing and live dialing arrive once a provider is fully wired up — for now this saves your
        details so you're ready to go.
      </p>

      <Card>
        <div className="flex flex-col gap-4">
          <SelectField label="Dialer provider" value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as DialerProvider }))}>
            {(Object.keys(PROVIDER_LABELS) as DialerProvider[]).map((p) => (
              <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
            ))}
          </SelectField>

          <Input label="Your dialer phone number" value={form.phone_number} onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))} placeholder="+1 555 123 4567" />
          <Input label="API key" type="password" value={form.api_key} onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} placeholder={settings ? 'Leave blank to keep the current key' : ''} />

          {msg && <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-danger' : 'text-success'}`}>{msg.text}</p>}

          <div>
            <Button onClick={() => void handleSave()} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
