import { useState } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { useOrgApiSettings } from '../hooks/useOrgApiSettings';
import type { OrgApiSetting } from '../hooks/useOrgApiSettings';
import { useOrg } from '../hooks/useOrg';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { ProviderGuide } from '../components/settings/ProviderGuide';

const PROVIDERS: {
  key: OrgApiSetting['provider'];
  label: string;
  url: string;
  ctaLabel: string;
  freeText: string;
  steps?: string[];
}[] = [
  {
    key: 'gemini',
    label: 'Gemini (AI drafting)',
    url: 'https://aistudio.google.com/apikey',
    ctaLabel: 'Get your free Gemini API key →',
    freeText: "Free — no credit card needed. This is a one-time setup for the whole organization, done once by whoever administers it. Usage bills to your own Google account, never Kevin's.",
    steps: [
      'Click the button above and sign in with your Google account.',
      'Click "Create API key".',
      'Copy the key and paste it into the box below.',
    ],
  },
  {
    key: 'google_places',
    label: 'Google Places (lead scraper)',
    url: 'https://console.cloud.google.com/google/maps-apis/credentials',
    ctaLabel: 'Open Google Cloud Console for Places →',
    freeText: "Google gives every account a $200/month free credit, which comfortably covers normal usage here — so it isn't unconditionally free above that. One-time setup for the whole organization; usage bills to your own Google Cloud account, never Kevin's.",
  },
  {
    key: 'companies_house',
    label: 'Companies House (lead scraper)',
    url: 'https://developer.company-information.service.gov.uk/',
    ctaLabel: 'Register for a free Companies House key →',
    freeText: "Free — registration has no cost. One-time setup for the whole organization, done once by whoever administers it.",
  },
  {
    key: 'apollo',
    label: 'Apollo.io (optional lead enrichment)',
    url: 'https://app.apollo.io/#/settings/integrations/api',
    ctaLabel: 'Get your Apollo API key →',
    freeText: "Paid — Apollo's free plan has no API access, so this needs a paid Apollo plan. Usage bills to your own Apollo account, never Kevin's. Entirely optional: only appears as an \"Enrich with Apollo\" button on individual leads if configured — nothing runs automatically.",
  },
  {
    key: 'hunter',
    label: 'Hunter.io (optional email finder)',
    url: 'https://hunter.io/api-keys',
    ctaLabel: 'Get your Hunter API key →',
    freeText: "Hunter's free plan includes some monthly credits but API access requires a paid plan. Usage bills to your own Hunter account, never Kevin's. Entirely optional: only appears as a \"Find email with Hunter\" button on individual leads if configured.",
  },
  {
    key: 'anthropic',
    label: 'Anthropic Claude (outreach AI)',
    url: 'https://console.anthropic.com/settings/keys',
    ctaLabel: 'Get your Anthropic API key →',
    freeText: "Powers cold-email/JV-pitch/LinkedIn drafting for this org. Trivially cheap at real volume (a few dollars a month even sending hundreds of messages). Mr Brush & Co and DI Dreamlabs fall back to Kevin's key automatically if this isn't configured, matching how Gemini already works — other orgs need their own key before outreach automation activates.",
  },
];

function ProviderRow({ provider, label, url, ctaLabel, freeText, steps, configured, onSave }: {
  provider: OrgApiSetting['provider']; label: string; url: string; ctaLabel: string; freeText: string; steps?: string[];
  configured: boolean; onSave: (provider: OrgApiSetting['provider'], key: string) => Promise<string | null>;
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
    <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <div className="flex items-center gap-2">
        <p className="font-semibold">{label}</p>
        {configured && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
            <CheckCircle2 className="h-3 w-3" aria-hidden /> Configured
          </span>
        )}
      </div>
      <ProviderGuide url={url} ctaLabel={ctaLabel} freeText={freeText} steps={steps} />
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
              url={p.url}
              ctaLabel={p.ctaLabel}
              freeText={p.freeText}
              steps={p.steps}
              configured={settings.find((s) => s.provider === p.key)?.is_configured ?? false}
              onSave={save}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
