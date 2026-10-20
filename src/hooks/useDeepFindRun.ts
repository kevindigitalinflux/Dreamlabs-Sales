import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { DeepFindLeadRow, DeepFindRun } from '../types';

/** A run row joined with the lead's name (null when the lead is not visible or was deleted). */
export type DeepFindRowWithLead = DeepFindLeadRow & { lead: { id: string; business_name: string; company_number?: string | null; country?: string | null; registry_candidates_rejected?: boolean; website?: string | null; email?: string | null; blocked_domains?: string[] } | null };

const POLL_MS = 15_000;

/**
 * One Deep find run and its leads, kept live by realtime, with a slow poll as a fallback while it runs. The channel
 * name includes useId() so two mounted users of this hook never share a channel (see CLAUDE.md). Late responses after
 * the run id changes or the component unmounts are ignored.
 */
export function useDeepFindRun(runId: string | null) {
  const instance = useId();
  const [run, setRun] = useState<DeepFindRun | null>(null);
  const [rows, setRows] = useState<DeepFindRowWithLead[]>([]);
  const [loading, setLoading] = useState(runId !== null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    setRun(null);
    setRows([]);
    setError(null);
    if (!runId) { setLoading(false); return; }
    setLoading(true);
    let active = true;
    const load = async () => {
      const [r, l] = await Promise.all([
        supabase.from('deep_find_runs').select('*').eq('id', runId).maybeSingle(),
        supabase.from('deep_find_leads').select('*, lead:leads(id, business_name, company_number, country, registry_candidates_rejected, website, email, blocked_domains)').eq('run_id', runId).order('updated_at'),
      ]);
      if (!active) return;
      const err = r.error ?? l.error;
      if (err) setError(err.message);
      else { setRun(r.data as DeepFindRun | null); setRows((l.data as DeepFindRowWithLead[] | null) ?? []); setError(null); }
      setLoading(false);
    };
    loadRef.current = load;
    void load();
    const channel = supabase
      .channel(`deep-find-${runId}-${instance}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deep_find_leads', filter: `run_id=eq.${runId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deep_find_runs', filter: `id=eq.${runId}` }, () => void load())
      .subscribe();
    return () => { active = false; loadRef.current = async () => {}; void supabase.removeChannel(channel); };
  }, [runId, instance]);

  const refresh = useCallback(() => void loadRef.current(), []);
  const running = run?.status === 'active';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, refresh]);

  return { run, rows, loading, error, refresh };
}
