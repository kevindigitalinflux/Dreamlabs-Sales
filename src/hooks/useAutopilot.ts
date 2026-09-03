import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import { useAuth } from './useAuth';
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
  ramp_up_enabled: boolean; max_total_spend_cents: number | null;
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
      supabase.from('autopilot_runs').select('*').eq('org_id', currentOrg.id).eq('status', 'active').maybeSingle(),
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
      max_total_spend_cents: input.max_total_spend_cents, ends_at: endsAt,
      estimated_cost_low_cents: low, estimated_cost_high_cents: high,
    });
    if (error) return error.message;
    await refresh();
    return null;
  }, [currentOrg, session, refresh]);

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

  return { run, blocklist, loading, createRun, stopRun, addBlocklistEntry, removeBlocklistEntry };
}
