import { useState } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { useOrgApiSettings } from '../hooks/useOrgApiSettings';
import type { OrgApiSetting } from '../hooks/useOrgApiSettings';
import { useOrg } from '../hooks/useOrg';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';

const PROVIDERS: { key: OrgApiSetting['provider']; label: string; hint: string }[] = [
  { key: 'gemini', label: 'Gemini (AI drafting)', hint: 'Free key from aistudio.google.com/apikey' },
  { key: 'google_places', label: 'Google Places (lead scraper)', hint: 'From Google Cloud Console — $200/month free credit' },
  { key: 'companies_house', label: 'Companies House (lead scraper)', hint: 'Free key from developer.company-information.service.gov.uk' },
];

function ProviderRow({ provider, label, hint, configured, onSave }: {
  provider: OrgApiSetting['provider']; label: string; hint: string; configured: boolean;
  onSave: (provider: OrgApiSetting['provider'], key: string) => Promise<string | null>;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function handleSave() {
    if (!key.trim()) return setMsg({ kind: 'err', text: 'Enter a key first.' });
    setBusy(true); setMsg(null);
    const err = await onSave(provider, key.trim());
    setBusy(false);
    if (err) return setMsg({ kind: 'err', text: err });
    setKey('');
    setMsg({ kind: 'ok', text: 'Key verified and saved.' });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-4">
      <div className="flex items-center gap-2">
        <p className="font-semibold">{label}</p>
        {configured && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
            <CheckCircle2 className="h-3 w-3" aria-hidden /> Configured
          </span>
        )}
      </div>
      <p className="text-xs text-muted">{hint}</p>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input label="API key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={configured ? 'Replace the saved key' : ''} />
        </div>
        <Button variant="secondary" onClick={() => void handleSave()} disabled={busy}>{busy ? 'Verifying…' : 'Save'}</Button>
      </div>
      {msg && <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-red-400' : 'text-emerald-400'}`}>{msg.text}</p>}
    </div>
  );
}

/** Org-level BYO API keys (Gemini/Places/Companies House) — org-admin only. */
export function OrganizationSettings() {
  const { currentOrg } = useOrg();
  const { settings, loading, save } = useOrgApiSettings();

  if (loading) return <Skeleton className="h-80 w-full max-w-2xl" />;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <header className="flex items-center gap-3">
        <KeyRound className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">{currentOrg?.name} — API keys</h1>
      </header>
      <p className="text-muted">
        These keys power AI drafting and the lead scraper for this organization. Usage bills to
        whichever key is configured here — never to Kevin's account.
      </p>
      <Card>
        <div className="flex flex-col gap-3">
          {PROVIDERS.map((p) => (
            <ProviderRow
              key={p.key}
              provider={p.key}
              label={p.label}
              hint={p.hint}
              configured={settings.find((s) => s.provider === p.key)?.is_configured ?? false}
              onSave={save}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
