import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Radar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import { useOrgApiSettings } from '../hooks/useOrgApiSettings';
import { usePipeline } from '../hooks/usePipeline';
import { usePipelineActions } from '../hooks/usePipelineActions';
import { StepProgress } from '../components/ui/StepProgress';
import { Input, SelectField, Textarea } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { IcpSelect } from '../components/emails/IcpSelect';
import { useIcps } from '../hooks/useIcps';
import { searchTextFromIcp } from '../lib/icp';
import type { IcpParams } from '../types';
import { SOURCE_NAMES, sourceAvailability, type SearchSource } from '../lib/scrapeMerge';
import { startScrapeSearch } from '../lib/scrapeSearch';
import { ScrapeSourceChoices } from '../components/scraper/ScrapeSourceChoices';

const TOTAL_STEPS = 4;

/** 4-step lead-scraper wizard: ICP text -> AI parse -> pick sources -> confirm+scrape (SPEC.md §5). */
export function Scraper() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentOrg } = useOrg();
  const { settings } = useOrgApiSettings();
  const { pipelines } = usePipeline();
  const { createPipeline } = usePipelineActions();
  const [step, setStep] = useState(1);
  const [rawInput, setRawInput] = useState('');
  const [icp, setIcp] = useState<IcpParams | null>(null);
  const { icps } = useIcps();
  const [icpId, setIcpId] = useState<string | null>(null);
  const [sources, setSources] = useState<SearchSource[]>(['google_places', 'companies_house']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pipelineChoice, setPipelineChoice] = useState<'existing' | 'new'>(() => ((location.state as { newPipeline?: boolean } | null)?.newPipeline ? 'new' : 'existing'));
  const [pipelineId, setPipelineId] = useState('');
  const [newPipelineName, setNewPipelineName] = useState('');

  const placesConfigured = settings.find((s) => s.provider === 'google_places')?.is_configured ?? false;
  const chConfigured = settings.find((s) => s.provider === 'companies_house')?.is_configured ?? false;
  const croConfigured = settings.find((s) => s.provider === 'cro')?.is_configured ?? false;
  const configured = { google_places: placesConfigured, companies_house: chConfigured, cro: croConfigured };
  const selectedSources = sources.filter((s) => !sourceAvailability(s, icp?.country, configured[s]));

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
      setStep(2);
    }
  }

  async function runScrape() {
    if (!currentOrg || !icp) return;
    if (!selectedSources.length) { setError('Choose at least one configured source'); return; }
    setBusy(true); setError(null);
    try {
      let targetPipelineId = pipelineId;
      if (pipelineChoice === 'new') {
        const { error: createErr, pipeline } = await createPipeline(newPipelineName);
        if (createErr || !pipeline) { setError(createErr ?? 'Could not create pipeline'); return; }
        targetPipelineId = pipeline.id;
      }
      const result = await startScrapeSearch(selectedSources, {
        org_id: currentOrg.id, icp_raw_input: rawInput, icp_params: icp,
        pipeline_id: targetPipelineId || null, icp_id: icpId,
      }, crypto.randomUUID(), (name, options) => supabase.functions.invoke(name, options));
      if (result.jobIds.length) navigate(`/scraper/jobs/${result.jobIds[0]}`);
      else setError(result.notes.join(' '));
    } catch (err) {
      console.error('Could not start lead search', err instanceof Error ? err.name : 'unknown');
      setError('Could not start the search. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-3">
        <Radar className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">Find leads</h1>
      </header>
      <StepProgress step={step} total={TOTAL_STEPS} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {step === 1 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Describe your ideal customer</p>
            <IcpSelect
              icps={icps}
              value={icpId}
              onChange={(id) => { setIcpId(id); const p = icps.find((x) => x.id === id); if (p && !rawInput.trim()) setRawInput(searchTextFromIcp(p)); }}
              label="Search for one of your customer profiles (optional)"
              hint="Leads you approve from this search are tagged with the profile, so emails to them use its pain points and context. Picking one also fills the description below if it is empty."
            />
            <Textarea
              label="ICP description"
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="Commercial cleaning companies in London, 10-30 staff, rating between 3.0 and 4.2, fewer than 30 reviews"
            />
            <Button onClick={() => void parseIcp()} disabled={busy || !rawInput.trim()} loading={busy}>
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
              <Badge className="bg-violet/15 text-violet">Country: {icp.country === 'GB' ? 'United Kingdom' : icp.country === 'IE' ? 'Ireland' : icp.country === 'US' ? 'United States' : 'Other'}</Badge>
              {icp.location && <Badge className="bg-violet/15 text-violet">Location: {icp.location}</Badge>}
              {icp.industry && <Badge className="bg-violet/15 text-violet">Industry: {icp.industry}</Badge>}
              {icp.min_staff != null && <Badge className="bg-violet/15 text-violet">Min staff: {icp.min_staff}</Badge>}
              {(icp.min_rating != null || icp.max_rating != null) && (
                <Badge className="bg-violet/15 text-violet">Rating: {icp.min_rating ?? '?'}–{icp.max_rating ?? '?'}</Badge>
              )}
              {icp.max_reviews != null && <Badge className="bg-violet/15 text-violet">Max reviews: {icp.max_reviews}</Badge>}
            </div>
            <SelectField label="Search country" value={icp.country} onChange={(e) => setIcp({ ...icp, country: e.target.value as IcpParams['country'] })}>
              <option value="GB">United Kingdom</option><option value="IE">Ireland</option>
              <option value="US">United States</option><option value="other">Other</option>
            </SelectField>
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
            <ScrapeSourceChoices country={icp.country} sources={sources} configured={configured} onChange={setSources} />
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={() => setStep(4)} disabled={!selectedSources.length}>Continue</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Ready to search {selectedSources.map((s) => SOURCE_NAMES[s]).join(' and ')}</p>
            <p className="text-sm text-muted">This runs in the background — you'll be taken to a live results page.</p>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="pipeline-choice" checked={pipelineChoice === 'existing'} onChange={() => setPipelineChoice('existing')} className="h-4 w-4 accent-violet-500" />
              Add results to an existing pipeline
            </label>
            {pipelineChoice === 'existing' && (
              <SelectField label="Pipeline" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
                <option value="">Choose pipeline…</option>
                {pipelines.filter((p) => p.org_id === currentOrg?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </SelectField>
            )}
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="pipeline-choice" checked={pipelineChoice === 'new'} onChange={() => setPipelineChoice('new')} className="h-4 w-4 accent-violet-500" />
              Create a new pipeline for these results
            </label>
            {pipelineChoice === 'new' && (
              <Input label="New pipeline name" value={newPipelineName} onChange={(e) => setNewPipelineName(e.target.value)} />
            )}
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(3)}>Back</Button>
              <Button
                onClick={() => void runScrape()}
                disabled={busy || !selectedSources.length || (pipelineChoice === 'existing' && !pipelineId) || (pipelineChoice === 'new' && !newPipelineName.trim())}
                loading={busy}
              >
                {busy ? 'Starting…' : 'Find leads'}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
