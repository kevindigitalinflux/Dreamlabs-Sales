import type { AnalyticsData } from '../../hooks/useAnalytics';
import { Card } from '../ui/Card';
import { DonutChart } from './DonutChart';

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Outreach performance: email/reply rate, sequence status, LinkedIn sends, scraper yield, autopilot spend. */
export function OutreachSection({ data, isAdmin }: { data: AnalyticsData; isAdmin: boolean }) {
  const sequenceData = data.sequenceStatusBreakdown.map((s) => ({ label: statusLabel(s.status), value: s.count }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] font-bold">Outreach</h2>
        {!isAdmin && (
          <span className="text-xs text-muted">
            Email, sequence, and scraper numbers reflect your own activity. LinkedIn and autopilot numbers are org-wide.
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Emails</h3>
          <div className="flex items-center justify-around py-6 text-center">
            <div>
              <p className="text-3xl font-extrabold text-cyan">{data.emailStats.sent}</p>
              <p className="text-xs text-muted">sent</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-cyan">{data.emailStats.replies}</p>
              <p className="text-xs text-muted">replies</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-cyan">{Math.round(data.emailStats.replyRate * 100)}%</p>
              <p className="text-xs text-muted">reply rate</p>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Sequence enrollments</h3>
          <DonutChart data={sequenceData} />
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">LinkedIn</h3>
          <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
            <span className="text-4xl font-extrabold text-cyan">{data.linkedinSent}</span>
            <span className="text-sm text-muted">DMs sent</span>
          </div>
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Scraper yield</h3>
          <div className="flex items-center justify-around py-6 text-center">
            <div>
              <p className="text-3xl font-extrabold text-cyan">{data.scraperYield.found}</p>
              <p className="text-xs text-muted">found</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-cyan">{data.scraperYield.approved}</p>
              <p className="text-xs text-muted">approved</p>
            </div>
          </div>
        </Card>

        <Card className="md:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-muted">Autopilot spend</h3>
          <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
            <span className="text-4xl font-extrabold text-cyan">${(data.autopilotSpendCents / 100).toFixed(2)}</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
