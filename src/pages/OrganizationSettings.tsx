import {KeyRound} from 'lucide-react';
import {Link,useLocation} from 'react-router';
import {useOrg} from '../hooks/useOrg';
import {useOrgApiSettings} from '../hooks/useOrgApiSettings';
import {useApiKeyHealth} from '../hooks/useApiKeyHealth';
import {KEY_PROVIDER_COPY,type KeyProvider} from '../../supabase/functions/_shared/keyHealthRules';
import {PROVIDERS} from '../components/settings/apiProviderConfig';
import {ProviderRow} from '../components/settings/ProviderRow';
import {KeyHealthSection} from '../components/settings/KeyHealthSection';
import {SectionTitle} from '../components/ui/SectionTitle';
import {KeyHealthTestButton} from '../components/settings/KeyHealthTestButton';
import {Skeleton} from '../components/ui/Skeleton';
import {LookupWorkerCard} from '../components/settings/LookupWorkerCard';
import {PlacesUsageMeter} from '../components/settings/PlacesUsageMeter';

/** Org-level provider settings with shared-key health and linked sections. */
export function OrganizationSettings() {
  const { currentOrg,isPlatformOwner } = useOrg();
  const health=useApiKeyHealth(currentOrg?.id);
  const {hash}=useLocation();
  const { settings, loading, save, workerHost, sharedWorker, removeWorker, removeFirecrawl, test, loadError } = useOrgApiSettings();

  if (loading) return <Skeleton className="h-80 w-full max-w-2xl" />;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <header className="flex items-center gap-3">
        <KeyRound className="h-6 w-6 text-link" aria-hidden />
        <h1 className="text-[28px] font-bold">{currentOrg?.name} — API keys</h1>
      </header>
      <p className="text-muted">
        These keys power AI drafting and the lead scraper for this organization. Usage bills to
        the configured key's Google or provider account. Organisations with shared access may use the shared account.
      </p>
      <SectionTitle icon={KeyRound} count={health.rows.length}>Provider key health</SectionTitle>
      {health.loading&&<p role="status" className="text-sm text-muted">Checking API key status…</p>}
      {health.error&&<p role="status" className="text-sm text-muted">{health.error}</p>}
      {!health.loading&&!health.error&&!health.rows.length&&<p className="text-sm text-muted">No active key alerts.</p>}
      {loadError && <p role="alert" className="text-sm text-danger">{loadError}</p>}
      {currentOrg?.role === 'admin' && !loadError && <LookupWorkerCard key={currentOrg.id}
        configured={settings.some((s) => s.provider === 'lookup_worker' && s.is_configured)}
        health={health.rows.find(row=>row.provider==='lookup_worker')} platformOwner={isPlatformOwner} onTest={()=>test('lookup_worker')} shared={sharedWorker} host={workerHost} onSave={(value) => save('lookup_worker', value)} onRemove={removeWorker} />}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3">
          {PROVIDERS.filter((p) => p.key !== 'firecrawl' || currentOrg?.role === 'admin').map((p) => (
            <ProviderRow
              key={`${currentOrg?.id}:${p.key}`}
              health={health.rows.find(row=>row.provider===p.key)} platformOwner={isPlatformOwner} onTest={currentOrg?.role==='admin'?test:undefined}
              provider={p.key}
              label={p.label}
              url={p.url}
              ctaLabel={p.ctaLabel}
              freeText={p.freeText}
              steps={p.steps}
              configured={settings.find((s) => s.provider === p.key)?.is_configured ?? false}
              onSave={save}
              onRemove={p.key === 'firecrawl' && !loadError ? removeFirecrawl : undefined}
            >
              {p.key === 'google_places' && currentOrg && <PlacesUsageMeter key={currentOrg.id} orgId={currentOrg.id} admin={currentOrg.role === 'admin'} />}
            </ProviderRow>
          ))}
        </div>
      </div>
      {(['google_places_pro','email_verifier','lookup_worker','firecrawl'] as KeyProvider[]).filter(provider=>
        (provider==='google_places_pro'||provider==='email_verifier'||currentOrg?.role!=='admin')
        &&(hash===`#${provider}`||health.rows.some(row=>row.provider===provider))).map(provider=><KeyHealthSection key={`${currentOrg?.id}:${provider}`} provider={provider} title={KEY_PROVIDER_COPY[provider].name} icon={KeyRound} row={health.rows.find(row=>row.provider===provider)} platformOwner={isPlatformOwner}>
        {provider==='google_places_pro'&&currentOrg?.role==='admin'?<KeyHealthTestButton test={()=>test('google_places_pro')}/>:provider==='email_verifier'?<p className="text-sm">Email checks use the <Link className="text-link underline" to="/settings/organization#lookup_worker">lookup worker connection</Link>. Ask an admin to check it.</p>:<p className="text-sm">Ask an admin to check this key.</p>}
      </KeyHealthSection>)}
    </div>
  );
}
