import { useEffect, useState } from 'react';
import { CheckCircle2, Mail } from 'lucide-react';
import { useEmailSettings } from '../hooks/useEmailSettings';
import type { SaveInput } from '../hooks/useEmailSettings';
import type { EmailProvider } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, SelectField } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';

const PRESETS: Record<EmailProvider, { host: string; port: number }> = {
  gmail: { host: 'smtp.gmail.com', port: 465 },
  outlook: { host: 'smtp-mail.outlook.com', port: 587 },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465 },
  smtp: { host: '', port: 587 },
};

const GMAIL_STEPS = [
  'Go to your Google Account → Security → turn ON 2-Step Verification (required).',
  'Search "App Passwords" in your Google Account settings.',
  'Create a new App Password — name it "Dreamlabs Sales".',
  'Paste the 16-character password below.',
];
const OUTLOOK_STEPS = [
  'Use your full Outlook/Hotmail address as the SMTP username.',
  'If you have 2-step verification, create an app password at account.microsoft.com → Security.',
  'Otherwise your normal password usually works. Paste it below.',
];

/** SMTP config wizard (SPEC.md §7 Email Config) — non-technical, provider-guided. */
export function EmailConfig() {
  const { settings, loading, error, save, sendTest } = useEmailSettings();
  const [form, setForm] = useState<SaveInput>({ provider: 'gmail', smtp_host: PRESETS.gmail.host, smtp_port: PRESETS.gmail.port, smtp_user: '', from_name: '', password: '' });
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (settings) {
      setForm((f) => ({ ...f, provider: settings.provider, smtp_host: settings.smtp_host ?? '', smtp_port: settings.smtp_port, smtp_user: settings.smtp_user ?? '', from_name: settings.from_name ?? '' }));
    }
  }, [settings]);

  function pickProvider(p: EmailProvider) {
    setForm((f) => ({ ...f, provider: p, smtp_host: PRESETS[p].host || f.smtp_host, smtp_port: PRESETS[p].port }));
  }

  async function handleSave() {
    setBusy('save'); setMsg(null);
    const err = await save(form);
    setBusy(null);
    setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Settings saved. Now send yourself a test email.' });
    if (!err) setForm((f) => ({ ...f, password: '' }));
  }
  async function handleTest() {
    setBusy('test'); setMsg(null);
    const err = await sendTest();
    setBusy(null);
    setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Test email sent — check your inbox!' });
  }

  if (loading) return <Skeleton className="h-80 w-full max-w-2xl" />;

  if (error) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <h1 className="text-[28px] font-extrabold">Email sending</h1>
        <Card>
          <p role="alert" className="text-sm text-red-400">Could not load your email settings — {error}</p>
        </Card>
      </div>
    );
  }

  const steps = form.provider === 'gmail' ? GMAIL_STEPS : form.provider === 'outlook' ? OUTLOOK_STEPS : [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <header className="flex items-center gap-3">
        <h1 className="text-[28px] font-extrabold">Email sending</h1>
        {settings?.is_verified && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Verified
          </span>
        )}
      </header>
      <p className="text-muted">Connect your own email address — everything you send goes out from it, not from a robot address.</p>

      <Card>
        <div className="flex flex-col gap-4">
          <SelectField label="Your email provider" value={form.provider} onChange={(e) => pickProvider(e.target.value as EmailProvider)}>
            <option value="gmail">Gmail / Google Workspace</option>
            <option value="outlook">Outlook / Hotmail</option>
            <option value="yahoo">Yahoo</option>
            <option value="smtp">Other (custom SMTP)</option>
          </SelectField>

          {steps.length > 0 && (
            <ol className="flex flex-col gap-2 rounded-lg bg-surface/60 p-4 text-sm">
              {steps.map((s, i) => (
                <li key={s} className="flex gap-2"><span className="font-bold text-cyan">{i + 1}.</span>{s}</li>
              ))}
            </ol>
          )}

          <Input label="Your email address" type="email" value={form.smtp_user} onChange={(e) => setForm((f) => ({ ...f, smtp_user: e.target.value }))} placeholder="you@example.com" />
          <Input label={form.provider === 'gmail' ? 'App password (16 characters)' : 'Password / app password'} type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder={settings ? 'Leave blank to keep the current password' : ''} />
          <Input label="From name (how recipients see you)" value={form.from_name} onChange={(e) => setForm((f) => ({ ...f, from_name: e.target.value }))} placeholder="e.g. Kevin at Dreamlabs" />

          {form.provider === 'smtp' && (
            <div className="flex gap-2">
              <Input label="SMTP host" value={form.smtp_host} onChange={(e) => setForm((f) => ({ ...f, smtp_host: e.target.value }))} />
              <Input label="Port" type="number" value={String(form.smtp_port)} onChange={(e) => setForm((f) => ({ ...f, smtp_port: Number(e.target.value) || 587 }))} />
            </div>
          )}

          {msg && <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-red-400' : 'text-emerald-400'}`}>{msg.text}</p>}

          <div className="flex items-center justify-between">
            <Button onClick={() => void handleSave()} disabled={busy !== null}>{busy === 'save' ? 'Saving…' : 'Save settings'}</Button>
            <Button variant="secondary" onClick={() => void handleTest()} disabled={busy !== null || !settings}>
              <Mail className="h-4 w-4" aria-hidden />
              {busy === 'test' ? 'Sending…' : 'Send test email'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
