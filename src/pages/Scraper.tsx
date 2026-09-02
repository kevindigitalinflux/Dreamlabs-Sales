import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Radar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import { useOrgApiSettings } from '../hooks/useOrgApiSettings';
import { StepProgress } from '../components/ui/StepProgress';
import { Textarea } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import type { IcpParams, ScrapeSource } from '../types';

const TOTAL_STEPS = 4;

/** 4-step lead-scraper wizard: ICP text -> AI parse -> pick sources -> confirm+scrape (SPEC.md §5). */
export function Scraper() {
  const navigate = useNavigate();
  const { currentOrg } = useOrg();
  const { settings } = useOrgApiSettings();
  const [step, setStep] = useState(1);
  const [rawInput, setRawInput] = useState('');
  const [icp, setIcp] = useState<IcpParams | null>(null);
  const [sources, setSources] = useState<Set<ScrapeSource>>(new Set(['google_places']));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placesConfigured = settings.find((s) => s.provider === 'google_places')?.is_configured ?? false;
  const chConfigured = settings.find((s) => s.provider === 'companies_house')?.is_configured ?? false;

  async function parseIcp() {
    if (!currentOrg || !rawInput.trim()) return;
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.functions.invoke('parse-icp', {
      body: { raw_input: rawInput, org_id: currentOrg.id },
    });
    setBusy(false);
    if (err) return setError(err.message);
    const result = data as { params?: IcpParams; error?: string };
    if (result.error) return setError(result.error);
    if (result.params) {
      setIcp(result.params);
      if (result.params.country !== 'GB') sources.delete('companies_house');
      setStep(2);
    }
  }

  async function runScrape() {
    if (!currentOrg || !icp) return;
    setBusy(true); setError(null);
    const functionName = sources.has('google_places') ? 'scrape-google-places' : 'scrape-companies-house';
    const { data, error: err } = await supabase.functions.invoke(functionName, {
      body: { org_id: currentOrg.id, icp_raw_input: rawInput, icp_params: icp },
    });
    setBusy(false);
    if (err) return setError(err.message);
    const result = data as { job_id?: string; error?: string };
    if (result.error) return setError(result.error);
    if (result.job_id) navigate(`/scraper/jobs/${result.job_id}`);
  }

  function toggleSource(source: ScrapeSource) {
    const next = new Set(sources);
    if (next.has(source)) next.delete(source);
    else next.add(source);
    setSources(next);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-3">
        <Radar className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">Find leads</h1>
      </header>
      <StepProgress step={step} total={TOTAL_STEPS} />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {step === 1 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Describe your ideal customer</p>
            <Textarea
              label="ICP description"
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="Commercial cleaning companies in London, 10-30 staff, rating between 3.0 and 4.2, fewer than 30 reviews"
            />
            <Button onClick={() => void parseIcp()} disabled={busy || !rawInput.trim()}>
              {busy ? 'Reading…' : 'Continue'}
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && icp && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Here's what I picked up</p>
            <div className="flex flex-wrap gap-2">
              {icp.location && <Badge className="bg-violet/15 text-violet">Location: {icp.location}</Badge>}
              {icp.industry && <Badge className="bg-violet/15 text-violet">Industry: {icp.industry}</Badge>}
              {icp.min_staff != null && <Badge className="bg-violet/15 text-violet">Min staff: {icp.min_staff}</Badge>}
              {(icp.min_rating != null || icp.max_rating != null) && (
                <Badge className="bg-violet/15 text-violet">Rating: {icp.min_rating ?? '?'}–{icp.max_rating ?? '?'}</Badge>
              )}
              {icp.max_reviews != null && <Badge className="bg-violet/15 text-violet">Max reviews: {icp.max_reviews}</Badge>}
            </div>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)}>Looks right</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 3 && icp && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Choose data sources</p>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={sources.has('google_places')} onChange={() => toggleSource('google_places')} disabled={!placesConfigured} className="h-4 w-4 accent-violet-500" />
              Google Places {!placesConfigured && <span className="text-xs text-muted">(no key configured — see Settings)</span>}
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={sources.has('companies_house')} onChange={() => toggleSource('companies_house')} disabled={icp.country !== 'GB' || !chConfigured} className="h-4 w-4 accent-violet-500" />
              Companies House {icp.country !== 'GB' && <span className="text-xs text-muted">(UK only)</span>}
              {icp.country === 'GB' && !chConfigured && <span className="text-xs text-muted">(no key configured — see Settings)</span>}
            </label>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={() => setStep(4)} disabled={sources.size === 0}>Continue</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Ready to search {[...sources].join(' + ')}</p>
            <p className="text-sm text-muted">This runs in the background — you'll be taken to a live results page.</p>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(3)}>Back</Button>
              <Button onClick={() => void runScrape()} disabled={busy}>{busy ? 'Starting…' : 'Find leads'}</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
