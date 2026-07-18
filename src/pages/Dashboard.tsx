import { useEffect, useState } from 'react';
import { useLeads } from '../hooks/useLeads';
import { useProfiles } from '../hooks/useProfiles';
import { useAuth } from '../hooks/useAuth';
import { useDashboardStats } from '../hooks/useDashboardStats';
import { useDrafts } from '../hooks/useDrafts';
import type { DraftLog } from '../hooks/useDrafts';
import { useFocusMode } from '../hooks/useFocusMode';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { StatsBar } from '../components/dashboard/StatsBar';
import { TodaysFocus } from '../components/dashboard/TodaysFocus';
import { EmailReviewQueue } from '../components/dashboard/EmailReviewQueue';
import { RecentlyActive } from '../components/dashboard/RecentlyActive';
import { PipelineSnapshot } from '../components/dashboard/PipelineSnapshot';
import { LeadPanel } from '../components/pipeline/LeadPanel';
import { EmailComposer } from '../components/emails/EmailComposer';
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
  const { callsThisWeek } = useDashboardStats();
  const { drafts, loading: draftsLoading, refresh: refreshDrafts } = useDrafts();
  const { focusMode } = useFocusMode();
  const [selected, setSelected] = useState<Lead | null>(null);
  const [reviewing, setReviewing] = useState<DraftLog | null>(null);
  const reviewLead = reviewing?.lead ? leads.find((l) => l.id === reviewing.lead!.id) ?? null : null;

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

      {!focusMode && <StatsBar leads={leads} leadsLoading={loading} draftCount={draftsLoading ? null : drafts.length} callsThisWeek={callsThisWeek} />}

      <Card>
        <h2 className="mb-3 text-[18px] font-bold">Today's follow-ups</h2>
        {loading && <Skeleton className="h-24 w-full" />}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {!loading && !error && <TodaysFocus leads={leads} onOpen={setSelected} />}
      </Card>

      <Card>
        <h2 className="mb-3 text-[18px] font-bold">Emails ready to review</h2>
        <EmailReviewQueue drafts={drafts} loading={draftsLoading} onReview={setReviewing} onChanged={() => void refreshDrafts()} />
      </Card>

      {!focusMode && (
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
      )}

      <LeadPanel lead={selected} profiles={profiles} onClose={() => setSelected(null)} onUpdate={updateLead} />

      {reviewing && reviewLead && (
        <EmailComposer
          lead={reviewLead}
          open
          onClose={() => { setReviewing(null); void refreshDrafts(); }}
          draft={{ log_id: reviewing.id, subject: reviewing.subject, body: reviewing.body }}
        />
      )}
    </div>
  );
}
