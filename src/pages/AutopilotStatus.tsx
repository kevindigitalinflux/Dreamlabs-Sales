import { useState } from 'react';
import { Link } from 'react-router';
import { Rocket, XCircle } from 'lucide-react';
import { useAutopilot } from '../hooks/useAutopilot';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

/** Live autopilot progress + blocklist management. */
export function AutopilotStatus() {
  const { run, blocklist, loading, stopRun, addBlocklistEntry, removeBlocklistEntry } = useAutopilot();
  const [blockValue, setBlockValue] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Skeleton className="h-96 w-full" />;

  const dayNumber = run ? Math.max(1, Math.floor((Date.now() - new Date(run.started_at).getTime()) / 86_400_000) + 1) : 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-3">
        <Rocket className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">Autopilot</h1>
      </header>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {!run && (
        <EmptyState
          icon={Rocket}
          title="No autopilot run active"
          hint="Start one to scrape leads and send cold outreach automatically, on a schedule you set."
          action={<Link to="/outreach/autopilot/new"><Button>Start autopilot</Button></Link>}
        />
      )}

      {run && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Day {dayNumber} of {run.duration_days}</p>
            <p className="text-sm text-muted">Leads scraped: {run.leads_scraped_total}</p>
            <p className="text-sm text-muted">Outreach sent: {run.outreach_sent_total}</p>
            <p className="text-sm text-muted">
              AI spend so far: ${(run.actual_ai_cost_cents / 100).toFixed(2)} (estimated ${(run.estimated_cost_low_cents / 100).toFixed(2)}–${(run.estimated_cost_high_cents / 100).toFixed(2)})
              {run.max_total_spend_cents != null && ` · cap $${(run.max_total_spend_cents / 100).toFixed(2)}`}
            </p>
            <p className="text-sm text-muted">Bounces: {run.bounce_count}</p>
            <Button variant="danger" onClick={() => void (async () => { setBusy(true); setError(await stopRun()); setBusy(false); })()} disabled={busy}>
              <XCircle className="h-4 w-4" aria-hidden /> Stop autopilot
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-3">
          <p className="font-semibold">Do-not-contact list</p>
          <div className="flex gap-2">
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
            >
              Add
            </Button>
          </div>
          {blocklist.length === 0 && <p className="text-sm text-muted">Nothing blocked.</p>}
          {blocklist.map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-lg bg-surface/50 p-2 text-sm">
              <span>{b.value}{b.reason && ` — ${b.reason}`}</span>
              <button type="button" onClick={() => void removeBlocklistEntry(b.id)} className="text-red-400" aria-label={`Remove ${b.value}`}>
                <XCircle className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
