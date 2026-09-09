import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useAnalytics } from '../hooks/useAnalytics';
import type { AnalyticsPeriod } from '../lib/analytics';
import { useOrg } from '../hooks/useOrg';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { PipelineSection } from '../components/analytics/PipelineSection';
import { OutreachSection } from '../components/analytics/OutreachSection';

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  this_month: 'This month',
  last_30_days: 'Last 30 days',
  all_time: 'All time',
};

/** /analytics — pipeline + outreach performance, org-scoped, role-honest (docs/superpowers/specs/2026-09-08-analytics-design.md). */
export function Analytics() {
  const { currentOrg } = useOrg();
  const [period, setPeriod] = useState<AnalyticsPeriod>('this_month');
  const { data, loading, error } = useAnalytics(period);
  const isAdmin = currentOrg?.role === 'admin';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Analytics</h1>
        <div role="group" aria-label="Time period" className="flex items-center gap-1 rounded-lg border border-line p-1">
          {(Object.keys(PERIOD_LABELS) as AnalyticsPeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`min-h-9 cursor-pointer rounded-md px-3 text-sm font-semibold ${period === p ? 'bg-violet text-on-accent' : 'text-muted hover:text-offwhite'}`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {!loading && error && (
        <Card>
          <p role="alert" className="text-sm text-danger">Could not load analytics — {error}</p>
        </Card>
      )}

      {!loading && !error && data && (
        <>
          {data.leadsByStage.every((s) => s.count === 0) ? (
            <EmptyState icon={BarChart3} title="No leads yet" hint="Pipeline analytics will appear here once you have leads." />
          ) : (
            <PipelineSection data={data} isAdmin={isAdmin} />
          )}

          {data.emailStats.sent === 0 && data.emailStats.replies === 0 && data.linkedinSent === 0 &&
           data.scraperYield.found === 0 && data.autopilotSpendCents === 0 &&
           data.sequenceStatusBreakdown.every((s) => s.count === 0) ? (
            <EmptyState icon={BarChart3} title="No outreach activity yet" hint="Outreach analytics will appear here once you've sent emails, LinkedIn messages, or run a scrape." />
          ) : (
            <OutreachSection data={data} isAdmin={isAdmin} />
          )}
        </>
      )}
    </div>
  );
}
