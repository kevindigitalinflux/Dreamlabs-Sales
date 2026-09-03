import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Rocket } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import { useOrgApiSettings } from '../hooks/useOrgApiSettings';
import { useAutopilot, estimateCostCents } from '../hooks/useAutopilot';
import { StepProgress } from '../components/ui/StepProgress';
import { Textarea, Input, SelectField } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import type { IcpParams, ScrapeSource } from '../types';

const DURATIONS = [1, 7, 14, 21, 30] as const;

/** Autopilot campaign setup wizard (SPEC.md — Autopilot Mode §3). */
export function AutopilotSetup() {
  const navigate = useNavigate();
  const { currentOrg } = useOrg();
  const { settings } = useOrgApiSettings();
  const { createRun } = useAutopilot();
  const [step, setStep] = useState(1);
  const [rawInput, setRawInput] = useState('');
  const [icp, setIcp] = useState<IcpParams | null>(null);
  const [source, setSource] = useState<ScrapeSource>('google_places');
  const [dailyLeadTarget, setDailyLeadTarget] = useState(10);
  const [dailyOutreachTarget, setDailyOutreachTarget] = useState(20);
  const [duration, setDuration] = useState<typeof DURATIONS[number]>(7);
  const [rampUp, setRampUp] = useState(true);
  const [spendCap, setSpendCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placesConfigured = settings.find((s) => s.provider === 'google_places')?.is_configured ?? false;
  // Companies House never populates email/phone/website, so no lead scraped from it can ever pass
  // the (email-required) auto-approval guardrail — run-autopilot auto-cancels any such run. Keep it
  // unselectable here rather than letting a user pick an option that can only ever burn a run for nothing.
  const sourceUnavailable = source === 'google_places' ? !placesConfigured : true;

  async function parseIcp() {
    if (!currentOrg || !rawInput.trim()) return;
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.functions.invoke('parse-icp', { body: { raw_input: rawInput, org_id: currentOrg.id } });
    setBusy(false);
    if (err) return setError(err.message);
    const result = data as { params?: IcpParams; error?: string };
    if (result.error) return setError(result.error);
    if (result.params) {
      setIcp(result.params);
      setStep(2);
    }
  }

  async function handleCreate() {
    if (!icp) return;
    setBusy(true); setError(null);
    const err = await createRun({
      icp_raw_input: rawInput, icp_params: icp, source, daily_lead_target: dailyLeadTarget,
      daily_outreach_target: dailyOutreachTarget, duration_days: duration, ramp_up_enabled: rampUp,
      max_total_spend_cents: spendCap ? Math.round(Number(spendCap) * 100) : null,
    });
    setBusy(false);
    if (err) return setError(err);
    navigate('/outreach/autopilot');
  }

  const { low, high } = estimateCostCents(dailyOutreachTarget, duration);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-3">
        <Rocket className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">Start autopilot</h1>
      </header>
      <StepProgress step={step} total={3} />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {step === 1 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Describe your ideal customer</p>
            <Textarea label="ICP description" value={rawInput} onChange={(e) => setRawInput(e.target.value)} placeholder="Commercial cleaning companies in London, 10-30 staff" />
            <Button onClick={() => void parseIcp()} disabled={busy || !rawInput.trim()}>{busy ? 'Reading…' : 'Continue'}</Button>
          </div>
        </Card>
      )}

      {step === 2 && icp && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Choose one data source</p>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="autopilot-source" checked={source === 'google_places'} onChange={() => setSource('google_places')} disabled={!placesConfigured} className="h-4 w-4 accent-violet-500" />
              Google Places {!placesConfigured && <span className="text-xs text-muted">(no key configured)</span>}
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="autopilot-source" checked={source === 'companies_house'} onChange={() => setSource('companies_house')} disabled className="h-4 w-4 accent-violet-500" />
              Companies House <span className="text-xs text-muted">(not yet supported for autopilot — no contact details available from this source)</span>
            </label>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)} disabled={sourceUnavailable}>Continue</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <div className="flex flex-col gap-4">
            <SelectField label="Duration" value={String(duration)} onChange={(e) => setDuration(Number(e.target.value) as typeof DURATIONS[number])}>
              <option value="1">1 day</option>
              <option value="7">1 week</option>
              <option value="14">2 weeks</option>
              <option value="21">3 weeks</option>
              <option value="30">1 month</option>
            </SelectField>
            <Input label="Leads to scrape per day" type="number" value={String(dailyLeadTarget)} onChange={(e) => setDailyLeadTarget(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
            <Input label="Cold outreach sends per day" type="number" value={String(dailyOutreachTarget)} onChange={(e) => setDailyOutreachTarget(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={rampUp} onChange={(e) => setRampUp(e.target.checked)} className="h-4 w-4 accent-violet-500" />
              Ramp up gradually over the first 4 days (recommended)
            </label>
            <Input label="Optional total spend cap ($)" type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} placeholder="No cap" />
            {dailyOutreachTarget > 30 && (
              <p role="alert" className="text-sm text-amber-400">
                {dailyOutreachTarget}/day is above the recommended safe ceiling (~30/day) for a mailbox's sender reputation. You can still proceed.
              </p>
            )}
            <p className="text-sm text-muted">Estimated Claude API cost for this run: ${(low / 100).toFixed(2)}–${(high / 100).toFixed(2)}, billed to your own Anthropic key.</p>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={() => void handleCreate()} disabled={busy}>{busy ? 'Starting…' : 'Start autopilot'}</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
