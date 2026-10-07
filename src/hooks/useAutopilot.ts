import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import { useAuth } from './useAuth';
import { localDateString } from '../../supabase/functions/_shared/autopilotEligibility';
import { mapRunInsertError } from '../lib/selectableLeads';
import type { AutopilotRun, IcpParams, OutreachBlocklistEntry, ScrapeSource } from '../types';

const HAIKU_CENTS_PER_DRAFT = 0.225;
const SONNET_CENTS_PER_DRAFT = 0.45;

/** Rough cost range for a run — a directional estimate, not exact billing. */
export function estimateCostCents(dailyOutreachTarget: number, durationDays: number): { low: number; high: number } {
  const drafts = dailyOutreachTarget * durationDays;
  return { low: Math.ceil(drafts * HAIKU_CENTS_PER_DRAFT), high: Math.ceil(drafts * SONNET_CENTS_PER_DRAFT) };
}

export interface CreateRunInput {
  icp_raw_input: string; icp_params: IcpParams; source: ScrapeSource;
  daily_lead_target: number; daily_outreach_target: number; duration_days: 1 | 7 | 14 | 21 | 30;
  ramp_up_enabled: boolean; max_total_spend_cents: number | null; icp_id?: string | null;
}

export interface CreateSelectedRunInput {
  leadIds: string[];
  /** Ids currently eligible in the current org; any selected id outside this set is refused. */
  eligibleLeadIds: string[];
  windowStart: string; windowEnd: string; timeZone: string;
  dailySendCap: number; maxTotalSpendCents: number | null;
}

export interface CreateSelectedRunResult {
  error: string | null; runId: string | null;
  /** Set when the run was saved but the engine could not be started right now. */
  notice: string | null;
}

/** The current org's active autopilot run (if any), plus its blocklist. */
export function useAutopilot() {
  const { currentOrg } = useOrg();
  const { session } = useAuth();
  const [run, setRun] = useState<AutopilotRun | null>(null);
  const [blocklist, setBlocklist] = useState<OutreachBlocklistEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!currentOrg) return;
    const [runRes, blocklistRes] = await Promise.all([
      supabase.from('autopilot_runs').select('*').eq('org_id', currentOrg.id).eq('status', 'active').eq('mode', 'discover').maybeSingle(),
      supabase.from('outreach_blocklist').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false }),
    ]);
    setRun((runRes.data as AutopilotRun | null) ?? null);
    setBlocklist((blocklistRes.data as OutreachBlocklistEntry[] | null) ?? []);
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createRun = useCallback(async (input: CreateRunInput): Promise<string | null> => {
    if (!currentOrg || !session) return 'No organization selected';
    const { low, high } = estimateCostCents(input.daily_outreach_target, input.duration_days);
    const endsAt = new Date(Date.now() + input.duration_days * 86_400_000).toISOString();
    const { error } = await supabase.from('autopilot_runs').insert({
      org_id: currentOrg.id, created_by: session.user.id,
      icp_raw_input: input.icp_raw_input, icp_params: input.icp_params, source: input.source,
      daily_lead_target: input.daily_lead_target, daily_outreach_target: input.daily_outreach_target,
      duration_days: input.duration_days, ramp_up_enabled: input.ramp_up_enabled,
      max_total_spend_cents: input.max_total_spend_cents, ends_at: endsAt, icp_id: input.icp_id ?? null,
      estimated_cost_low_cents: low, estimated_cost_high_cents: high,
    });
    if (error) return error.message;
    await refresh();
    return null;
  }, [currentOrg, session, refresh]);

  /** Creates a selected-leads run plus its queue, then asks the engine to start (best effort). */
  const createSelectedRun = useCallback(async (input: CreateSelectedRunInput): Promise<CreateSelectedRunResult> => {
    if (!currentOrg || !session) return { error: 'No organization selected', runId: null, notice: null };
    const eligible = new Set(input.eligibleLeadIds);
    if (input.leadIds.length === 0 || input.leadIds.some((id) => !eligible.has(id))) {
      return { error: 'Some selected leads are no longer available. Review your selection and try again.', runId: null, notice: null };
    }
    const { data: runRow, error: runErr } = await supabase.from('autopilot_runs').insert({
      org_id: currentOrg.id, created_by: session.user.id, mode: 'selected', status: 'active',
      window_start: input.windowStart, window_end: input.windowEnd, timezone: input.timeZone,
      window_date: localDateString(new Date(), input.timeZone), daily_send_cap: input.dailySendCap,
      max_total_spend_cents: input.maxTotalSpendCents, started_at: new Date().toISOString(),
    }).select().single();
    if (runErr || !runRow) return { error: runErr ? mapRunInsertError(runErr) : 'Could not create the run', runId: null, notice: null };
    const runId = (runRow as AutopilotRun).id;
    const { error: leadsErr } = await supabase.from('autopilot_run_leads').insert(
      input.leadIds.map((lead_id) => ({ run_id: runId, lead_id, org_id: currentOrg.id, status: 'queued' })),
    );
    if (leadsErr) {
      const { error: delErr } = await supabase.from('autopilot_runs').delete().eq('id', runId);
      const error = delErr
        ? `The run was partially created and could not be removed (${delErr.message}). Reason it failed: ${leadsErr.message}`
        : leadsErr.message;
      return { error, runId: null, notice: null };
    }
    const { error: invokeErr } = await supabase.functions.invoke('run-selected-autopilot', { body: { action: 'start', run_id: runId } });
    const notice = invokeErr ? 'Your run is saved but could not be started right now. It will begin automatically on the next scheduled check.' : null;
    return { error: null, runId, notice };
  }, [currentOrg, session]);

  const stopRun = useCallback(async (): Promise<string | null> => {
    if (!run) return 'No active run';
    const { error } = await supabase.from('autopilot_runs').update({ status: 'cancelled', cancel_reason: 'stopped by user' }).eq('id', run.id);
    if (error) return error.message;
    await refresh();
    return null;
  }, [run, refresh]);

  const addBlocklistEntry = useCallback(async (value: string, reason: string): Promise<string | null> => {
    if (!currentOrg) return 'No organization selected';
    const { error } = await supabase.from('outreach_blocklist').insert({ org_id: currentOrg.id, value: value.toLowerCase().trim(), reason: reason || null, created_by: session?.user.id });
    if (error) return error.message;
    await refresh();
    return null;
  }, [currentOrg, session, refresh]);

  const removeBlocklistEntry = useCallback(async (id: string): Promise<string | null> => {
    const { error } = await supabase.from('outreach_blocklist').delete().eq('id', id);
    if (error) return error.message;
    await refresh();
    return null;
  }, [refresh]);

  return { run, blocklist, loading, createRun, createSelectedRun, stopRun, addBlocklistEntry, removeBlocklistEntry };
}
