import { useEffect, useState } from 'react';
import { useLeads } from '../hooks/useLeads';
import { useProfiles } from '../hooks/useProfiles';
import { useAuth } from '../hooks/useAuth';
import { useDashboardStats } from '../hooks/useDashboardStats';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { StatsBar } from '../components/dashboard/StatsBar';
import { TodaysFocus } from '../components/dashboard/TodaysFocus';
import { EmailReviewQueue } from '../components/dashboard/EmailReviewQueue';
import { RecentlyActive } from '../components/dashboard/RecentlyActive';
import { PipelineSnapshot } from '../components/dashboard/PipelineSnapshot';
import { LeadPanel } from '../components/pipeline/LeadPanel';
import type { Lead } from '../types';

function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Today's Focus dashboard (SPEC.md §8) — chunked, scannable, low cognitive load. */
export function Dashboard() {
  const { profile } = useAuth();
  const { leads, loading, error, updateLead } = useLeads();
  const { profiles } = useProfiles();
  const { draftCount, callsThisWeek } = useDashboardStats();
  const [selected, setSelected] = useState<Lead | null>(null);

  useEffect(() => {
    if (selected) setSelected(leads.find((l) => l.id === selected.id) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads]);

  const firstName = (profile?.full_name ?? profile?.email ?? '').split(' ')[0];
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[28px] font-extrabold">{greeting()}, {firstName}</h1>
        <p className="text-muted">{today}</p>
      </header>

      <StatsBar leads={leads} leadsLoading={loading} draftCount={draftCount} callsThisWeek={callsThisWeek} />

      <Card>
        <h2 className="mb-3 text-[18px] font-bold">Today's follow-ups</h2>
        {loading && <Skeleton className="h-24 w-full" />}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {!loading && !error && <TodaysFocus leads={leads} onOpen={setSelected} />}
      </Card>

      <Card>
        <h2 className="mb-3 text-[18px] font-bold">Emails ready to review</h2>
        <EmailReviewQueue draftCount={draftCount} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-[18px] font-bold">Recently active</h2>
          {loading ? <Skeleton className="h-24 w-full" /> : <RecentlyActive leads={leads} onOpen={setSelected} />}
        </Card>
        <Card>
          <h2 className="mb-3 text-[18px] font-bold">Pipeline snapshot</h2>
          {loading ? <Skeleton className="h-24 w-full" /> : <PipelineSnapshot leads={leads} />}
        </Card>
      </div>

      <LeadPanel lead={selected} profiles={profiles} onClose={() => setSelected(null)} onUpdate={updateLead} />
    </div>
  );
}
