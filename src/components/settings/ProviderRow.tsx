import {useState} from 'react';
import {KeyRound,CheckCircle2} from 'lucide-react';
import type {OrgApiSetting} from '../../hooks/useOrgApiSettings';
import type {ApiKeyHealthRow} from '../../lib/keyHealthView';
import {PROVIDER_ICONS} from './apiProviderConfig';
import {KeyHealthSection} from './KeyHealthSection';
import {Button} from '../ui/Button';
import {Input} from '../ui/Input';
import {ProviderGuide} from './ProviderGuide';

export function ProviderRow({ provider, label, url, ctaLabel, freeText, steps, configured, onSave, onRemove, children, health, platformOwner, onTest }: {
  health?:ApiKeyHealthRow; platformOwner?:boolean; onTest?:(provider:OrgApiSetting['provider'])=>Promise<string|null>;
  children?: import('react').ReactNode;
  provider: OrgApiSetting['provider']; label: string; url: string; ctaLabel: string; freeText: string; steps?: string[];
  onRemove?: () => Promise<string | null>;
  configured: boolean; onSave: (provider: OrgApiSetting['provider'], key: string) => Promise<string | null>;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function handleSave() {
    if (!key.trim()) return setMsg({ kind: 'err', text: 'Enter a key first.' });
    setBusy(true); setMsg(null);
    try {
      const err = await onSave(provider, key.trim());
      if (err) return setMsg({ kind: 'err', text: err });
      setKey('');
      setMsg({ kind: 'ok', text: 'Key verified and saved.' });
    } catch {
      console.error('settings: provider key could not be saved');
      setMsg({ kind: 'err', text: 'Could not save the key. Try again.' });
    } finally { setBusy(false); }
  }

  async function handleRemove() {
    if (!onRemove) return;
    setBusy(true); setMsg(null);
    try {
      const err = await onRemove();
      if (err) return setMsg({ kind: 'err', text: err });
      setKey('');
      setMsg({ kind: 'ok', text: 'Firecrawl key removed.' });
    } catch {
      console.error('settings: Firecrawl key could not be removed');
      setMsg({ kind: 'err', text: 'Could not remove the Firecrawl key. Try again.' });
    } finally { setBusy(false); }
  }

  return (
    <KeyHealthSection
      provider={provider} row={health} platformOwner={platformOwner}
      icon={PROVIDER_ICONS[provider] ?? KeyRound}
      title={label}
      summary={configured ? <span className="font-medium text-success">Configured</span> : 'Not set up yet'}
    >
    <div className="flex flex-col gap-3">
      {configured && (
        <span className="flex w-fit items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-success">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Configured
        </span>
      )}
      <ProviderGuide url={url} ctaLabel={ctaLabel} freeText={freeText} steps={steps} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <Input label="API key" type={provider === 'firecrawl' ? 'password' : 'text'} autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={configured ? 'Replace the saved key' : ''} />
        </div>
        <Button variant="secondary" onClick={() => void handleSave()} disabled={busy} loading={busy}>{busy ? 'Working…' : 'Save'}</Button>
        {configured && onRemove && <Button variant="secondary" aria-label="Remove Firecrawl key" disabled={busy} onClick={() => void handleRemove()}>Remove</Button>}
      </div>
      {onTest&&<Button variant="secondary" disabled={busy} onClick={()=>{setBusy(true);setMsg(null);void onTest(provider).then(error=>setMsg({kind:error?'err':'ok',text:error??'Key test passed.'})).catch(()=>{console.error('key_test_failed');setMsg({kind:'err',text:'Could not test this key.'});}).finally(()=>setBusy(false));}}>Test current key</Button>}
      {children}
      {msg && <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-danger' : 'text-success'}`}>{msg.text}</p>}
    </div>
    </KeyHealthSection>
  );
}
