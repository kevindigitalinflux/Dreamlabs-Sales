import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { endOfLocalDay, type EligibilityEnrollment } from '../../supabase/functions/_shared/autopilotEligibility';
import { groupSelectableLeads, type PipelineGroup } from '../lib/selectableLeads';
import { useOrg } from './useOrg';
import { usePipeline } from './usePipeline';
import { useOrgLeads } from './useOrgLeads';

interface EnrollmentRow { lead_id: string; status: EligibilityEnrollment['status']; next_send_at: string | null }

/**
 * The current org's leads that autopilot may act on today, grouped by pipeline. Loads only what the
 * user's RLS allows. `timeZone` decides what "due today" means (end of that local day).
 */
export function useSelectableLeads(timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const { currentOrg } = useOrg();
  const { pipelines, loading: pipelinesLoading } = usePipeline();
  const { leads, loading: leadsLoading, error: leadsError } = useOrgLeads();
  const [loaded, setLoaded] = useState<{ orgId: string; enrollments: Map<string, EligibilityEnrollment>; blocked: Set<string> } | null>(null);
  const [extraError, setExtraError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrg) return;
    setLoaded(null);
    setExtraError(null);
    let cancelled = false;
    void (async () => {
      const [enrRes, blRes] = await Promise.all([
        supabase.from('sequence_enrollments').select('lead_id,status,next_send_at,leads!inner(org_id)')
          .eq('leads.org_id', currentOrg.id).in('status', ['active', 'paused']),
        supabase.from('outreach_blocklist').select('value').eq('org_id', currentOrg.id),
      ]);
      if (cancelled) return;
      const err = enrRes.error ?? blRes.error;
      if (err) { setExtraError(err.message); return; }
      const map = new Map<string, EligibilityEnrollment>();
      for (const r of (enrRes.data ?? []) as unknown as EnrollmentRow[]) {
        // An active enrolment wins over a paused one for the same lead.
        if (map.get(r.lead_id)?.status === 'active') continue;
        map.set(r.lead_id, { status: r.status, next_send_at: r.next_send_at });
      }
      setLoaded({ orgId: currentOrg.id, enrollments: map, blocked: new Set(((blRes.data ?? []) as { value: string }[]).map((b) => b.value)) });
    })();
    return () => { cancelled = true; };
  }, [currentOrg]);

  const byPipeline: PipelineGroup[] = useMemo(() => {
    if (!currentOrg || !loaded || loaded.orgId !== currentOrg.id) return [];
    const now = new Date();
    const orgPipelines = pipelines.filter((p) => p.org_id === currentOrg.id);
    return groupSelectableLeads(orgPipelines, leads, loaded.enrollments, loaded.blocked, endOfLocalDay(now, timeZone), now);
  }, [currentOrg, pipelines, leads, loaded, timeZone]);

  const error = leadsError ?? extraError;
  // With no org there is nothing to load: report not loading so the picker shows its no-org state.
  const loading = !!currentOrg && !error && (pipelinesLoading || leadsLoading || loaded?.orgId !== currentOrg.id);
  return { loading, error, byPipeline, hasOrg: !!currentOrg };
}
