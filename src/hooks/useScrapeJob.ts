import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ScrapeJob, RawLead } from '../types';
import { readScrapeGroup } from '../../supabase/functions/_shared/scrapeGroup';
import { mergeScrapeLeads } from '../lib/scrapeMerge';

/** Complete snapshot or an error: callers must not approve from a partially loaded group. */
export async function loadScrapeSearch(jobId: string): Promise<{ jobs: ScrapeJob[]; rawLeads: RawLead[] }> {
  const anchor = await supabase.from('scrape_jobs').select('*').eq('id', jobId).single();
  if (anchor.error) throw anchor.error;
  const job = anchor.data as ScrapeJob;
  const group = readScrapeGroup(job.icp_params);
  let found = [job];
  if (group) {
    // Scope the marker to its org and creator; a marker can never widen RLS access.
    let query = supabase.from('scrape_jobs').select('*').eq('org_id', job.org_id)
      .eq('icp_params->scrape_group->>id', group.id).order('created_at');
    query = job.created_by ? query.eq('created_by', job.created_by) : query.is('created_by', null);
    const result = await query;
    if (result.error) throw result.error;
    found = (result.data ?? []) as ScrapeJob[];
  }
  const rows: RawLead[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await supabase.from('raw_leads').select('*').in('scrape_job_id', found.map((j) => j.id))
      .order('created_at').order('id').range(from, from + 999);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []) as RawLead[]);
    if ((result.data?.length ?? 0) < 1000) break;
  }
  return { jobs: found, rawLeads: rows };
}

/** Legacy single jobs and durable grouped searches share one review view. Reads use the user's RLS session. */
export function useScrapeJob(jobId: string) {
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [rawLeads, setRawLeads] = useState<RawLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++version.current;
    try {
      const result = await loadScrapeSearch(jobId);
      if (request === version.current) { setJobs(result.jobs); setRawLeads(result.rawLeads); setError(null); }
    } catch (err) {
      console.error('Could not load scrape results', (err as { code?: string })?.code ?? 'unknown');
      if (request === version.current) setError('Could not load all search results. Refresh to try again.');
    } finally { if (request === version.current) setLoading(false); }
  }, [jobId]);

  useEffect(() => {
    setLoading(true); setJobs([]); setRawLeads([]); setError(null);
    void refresh();
    // Also discovers late job creation after a source's start request timed out.
    const timer = setInterval(() => void refresh(), 5000);
    return () => { clearInterval(timer); version.current++; };
  }, [refresh]);

  const jobIds = jobs.map((j) => j.id).sort().join(',');
  useEffect(() => {
    if (!jobIds) return;
    const channel = supabase.channel(`scrape-search-${jobId}`);
    for (const id of jobIds.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'scrape_jobs', filter: `id=eq.${id}` }, () => void refresh())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'raw_leads', filter: `scrape_job_id=eq.${id}` }, () => void refresh());
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [jobIds, jobId, refresh]);

  return { job: jobs.find((j) => j.id === jobId) ?? null, jobs, rawLeads: mergeScrapeLeads(rawLeads), loading, error, refresh };
}
