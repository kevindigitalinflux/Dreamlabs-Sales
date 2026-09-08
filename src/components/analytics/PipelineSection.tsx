import { formatCurrency, stageInfo } from '../../lib/utils';
import type { AnalyticsData } from '../../hooks/useAnalytics';
import { Card } from '../ui/Card';
import { BarChart } from './BarChart';
import { DonutChart } from './DonutChart';

/** Pipeline health: leads by stage/vertical/contractor, conversion funnel, won deals. */
export function PipelineSection({ data, isAdmin }: { data: AnalyticsData; isAdmin: boolean }) {
  const stageData = data.leadsByStage.map((s) => ({ label: stageInfo(s.stage).label, value: s.count }));
  const verticalData = data.leadsByVertical.map((v) => ({ label: v.vertical, value: v.count }));
  const funnelData = data.funnel.map((f) => ({ label: stageInfo(f.stage).label, value: f.count }));
  const contractorData = data.leadsByContractor?.map((c) => ({ label: c.contractorName, value: c.count })) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] font-bold">Pipeline</h2>
        {!isAdmin && <span className="text-xs text-muted">Showing your own activity. Admins see the whole org.</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Leads by stage</h3>
          <BarChart data={stageData} color="#00DFDF" />
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Leads by vertical</h3>
          <DonutChart data={verticalData} />
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Conversion funnel</h3>
          <BarChart data={funnelData} color="#8B32FF" />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {data.funnel.map((f) => (
              <span key={f.stage}>
                {stageInfo(f.stage).label}
                {f.conversionFromPrevious !== null && ` — ${Math.round(f.conversionFromPrevious * 100)}%`}
              </span>
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Won deals</h3>
          <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
            <span className="text-4xl font-extrabold text-cyan">{data.wonDeals.count}</span>
            <span className="text-sm text-muted">deals — {formatCurrency(data.wonDeals.totalValue)}</span>
          </div>
        </Card>

        {isAdmin && data.leadsByContractor && (
          <Card className="md:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-muted">Leads by contractor</h3>
            <BarChart data={contractorData} color="#F0386B" />
          </Card>
        )}
      </div>
    </div>
  );
}
