import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ScrapeJob, RawLead } from '../types';

/** A single scrape job + its raw leads, realtime-subscribed to both. */
export function useScrapeJob(jobId: string) {
  const [job, setJob] = useState<ScrapeJob | null>(null);
  const [rawLeads, setRawLeads] = useState<RawLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [jobRes, leadsRes] = await Promise.all([
      supabase.from('scrape_jobs').select('*').eq('id', jobId).single(),
      supabase.from('raw_leads').select('*').eq('scrape_job_id', jobId).order('created_at'),
    ]);
    if (jobRes.error) setError(jobRes.error.message);
    else { setJob(jobRes.data as ScrapeJob); setError(null); }
    if (!leadsRes.error) setRawLeads((leadsRes.data as RawLead[] | null) ?? []);
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel(`scrape-job-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scrape_jobs', filter: `id=eq.${jobId}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'raw_leads', filter: `scrape_job_id=eq.${jobId}` }, () => void refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobId, refresh]);

  return { job, rawLeads, loading, error, refresh };
}
