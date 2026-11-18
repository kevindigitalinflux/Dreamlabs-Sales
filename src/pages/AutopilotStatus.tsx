import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Ban, Rocket, XCircle } from 'lucide-react';
import { useAutopilot } from '../hooks/useAutopilot';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Collapsible } from '../components/ui/Collapsible';
import { SectionTitle } from '../components/ui/SectionTitle';
import { Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectedRunSection } from '../components/autopilot/SelectedRunSection';
import { useSelectedRun } from '../hooks/useSelectedRun';

/** Live autopilot progress + blocklist management. */
export function AutopilotStatus() {
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const { run, blocklist, loading, stopRun, addBlocklistEntry, removeBlocklistEntry } = useAutopilot();
  const selected = useSelectedRun();
  const [blockValue, setBlockValue] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading || selected.loading) return <Skeleton className="h-96 w-full" />;

  const dayNumber = run ? Math.max(1, Math.floor((Date.now() - new Date(run.started_at).getTime()) / 86_400_000) + 1) : 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-3">
        <Rocket className="h-6 w-6 text-link" aria-hidden />
        <h1 className="text-[28px] font-bold">Autopilot</h1>
      </header>
      {notice && <p role="status" className="text-sm text-warning">{notice}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {!run && selected.run?.status !== 'active' && (
        <EmptyState
          icon={Rocket}
          title="No autopilot run active"
          hint="Start one to scrape leads and send cold outreach automatically, on a schedule you set."
          action={<Link to="/outreach/autopilot/new"><Button>Start autopilot</Button></Link>}
        />
      )}

      {selected.error && <p role="alert" className="text-sm text-danger">Could not load the selected leads run: {selected.error}</p>}
      {selected.run && <SelectedRunSection run={selected.run} refresh={selected.refresh} stopRun={selected.stopRun} controlRun={selected.controlRun} />}

      {run && (
        <Card>
          <div className="flex flex-col gap-4">
            <div>
              <SectionTitle icon={Rocket}>Day {dayNumber} of {run.duration_days}</SectionTitle>
              {run.duration_days != null && (
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={Math.min(dayNumber, run.duration_days)} aria-valuemin={0} aria-valuemax={run.duration_days} aria-label="Autopilot progress">
                  <div className="h-full bg-violet" style={{ width: `${Math.min(100, Math.round((dayNumber / run.duration_days) * 100))}%` }} />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-nested bg-surface p-3"><b className="block font-heading text-xl font-bold">{run.leads_scraped_total}</b><span className="text-[13px] text-muted">Leads scraped</span></div>
              <div className="rounded-nested bg-surface p-3"><b className="block font-heading text-xl font-bold">{run.outreach_sent_total}</b><span className="text-[13px] text-muted">Outreach sent</span></div>
              <div className="rounded-nested bg-surface p-3"><b className="block font-heading text-xl font-bold">${(run.actual_ai_cost_cents / 100).toFixed(2)}</b><span className="text-[13px] text-muted">AI spend so far</span></div>
              <div className="rounded-nested bg-surface p-3"><b className={`block font-heading text-xl font-bold ${run.bounce_count > 0 ? 'text-attention' : ''}`}>{run.bounce_count}</b><span className="text-[13px] text-muted">Bounces</span></div>
            </div>
            <p className="text-sm text-muted">
              Estimated ${(run.estimated_cost_low_cents / 100).toFixed(2)} to ${(run.estimated_cost_high_cents / 100).toFixed(2)}
              {run.max_total_spend_cents != null && `, cap $${(run.max_total_spend_cents / 100).toFixed(2)}`}
            </p>
            <Button variant="danger" className="self-start" onClick={() => void (async () => { setBusy(true); setError(await stopRun()); setBusy(false); })()} disabled={busy} loading={busy}>
              <XCircle className="h-4 w-4" aria-hidden /> Stop autopilot
            </Button>
          </div>
        </Card>
      )}

      <Collapsible icon={Ban} title="Do-not-contact list" summary={blocklist.length === 0 ? 'Nothing blocked' : `${blocklist.length} blocked`}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <Input label="Email or domain" value={blockValue} onChange={(e) => setBlockValue(e.target.value)} placeholder="acme.com" />
            <Input label="Reason (optional)" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />
            <Button
              variant="secondary"
              onClick={() => void (async () => {
                if (!blockValue.trim()) return;
                setBusy(true);
                const err = await addBlocklistEntry(blockValue, blockReason);
                setBusy(false);
                if (err) setError(err); else { setBlockValue(''); setBlockReason(''); }
              })()}
              disabled={busy}
              loading={busy}
            >
              Add
            </Button>
          </div>
          {blocklist.length === 0 && <p className="text-sm text-muted">Nothing blocked.</p>}
          {blocklist.map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-control bg-surface p-2 text-sm">
              <span>{b.value}{b.reason && ` — ${b.reason}`}</span>
              <button type="button" onClick={() => void removeBlocklistEntry(b.id)} className="text-danger" aria-label={`Remove ${b.value}`}>
                <XCircle className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </Collapsible>
    </div>
  );
}
