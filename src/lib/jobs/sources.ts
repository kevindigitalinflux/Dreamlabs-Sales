// src/lib/jobs/sources.ts
// One adapter per run type. Each loads recent rows for an organisation and maps them to JobItem with the pure mappers
// in ./model. Sub-project C adds a job type by appending one adapter to JOB_SOURCES.
import { supabase } from '../supabase';
import { fetchLogStatuses } from '../../hooks/useDraftStatuses';
import {
  mapCampaign, mapDeepFind, mapScrape, mapSelectedOutreach,
  type DeepFindLeadInput, type DeepFindRunInput, type JobItem, type JobKind, type SelectedLeadInput, type SelectedRunInput, type ScrapeJobInput, type CampaignRunInput,
} from './model';

export interface JobSource {
  kind: JobKind;
  /** Tables to listen to for live updates (byOrg: the table has an org_id column the realtime filter can use). */
  watch: Array<{ table: string; byOrg: boolean }>;
  load(orgId: string): Promise<JobItem[]>;
}

/** The table a job of each kind is deleted from (the campaign is read-only and has none). */
export const JOB_TABLE: Partial<Record<JobKind, string>> = {
  deep_find: 'deep_find_runs',
  selected_outreach: 'autopilot_runs',
  scrape: 'scrape_jobs',
};

const WINDOW_DAYS = 60;
const MAX_JOBS = 100;
const LEAD_PAGE = 1000;
const sinceIso = () => new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function fail(what: string, message: string): never {
  throw new Error(`${what}: ${message}`);
}

// ---------- Deep find ----------
interface DeepFindLeadRow {
  run_id: string; status: DeepFindLeadInput['status']; people_found: number; domains: unknown;
  lead: { business_name: string | null; company_number: string | null } | null;
}

const deepFind: JobSource = {
  kind: 'deep_find',
  watch: [{ table: 'deep_find_runs', byOrg: true }, { table: 'deep_find_leads', byOrg: true }],
  async load(orgId) {
    const { data: runData, error } = await supabase.from('deep_find_runs')
      .select('id, status, lead_count, started_at, finished_at')
      .eq('org_id', orgId).gte('started_at', sinceIso()).order('started_at', { ascending: false }).limit(MAX_JOBS);
    if (error) fail('deep find runs', error.message);
    const runs = (runData as DeepFindRunInput[] | null) ?? [];
    const byRun = new Map<string, DeepFindLeadInput[]>();
    for (const ids of chunk(runs.map((r) => r.id), 20)) {
      const { data, error: leadErr } = await supabase.from('deep_find_leads')
        .select('run_id, status, people_found, domains, lead:leads(business_name, company_number)')
        .in('run_id', ids).limit(1000);
      if (leadErr) fail('deep find leads', leadErr.message);
      for (const row of (data as unknown as DeepFindLeadRow[] | null) ?? []) {
        const list = byRun.get(row.run_id) ?? [];
        list.push({ status: row.status, people_found: row.people_found, domains: row.domains, business_name: row.lead?.business_name ?? null, company_number: row.lead?.company_number ?? null });
        byRun.set(row.run_id, list);
      }
    }
    return runs.map((run) => mapDeepFind(run, byRun.get(run.id) ?? []));
  },
};

// ---------- Selected-leads outreach ----------
interface SelectedLeadRow { run_id: string; status: string; email_log_id: string | null; updated_at: string; lead: { business_name: string | null } | null }

const selectedOutreach: JobSource = {
  kind: 'selected_outreach',
  watch: [{ table: 'autopilot_runs', byOrg: true }, { table: 'autopilot_run_leads', byOrg: true }],
  async load(orgId) {
    const { data: runData, error } = await supabase.from('autopilot_runs')
      .select('id, status, started_at')
      .eq('org_id', orgId).eq('mode', 'selected').gte('started_at', sinceIso()).order('started_at', { ascending: false }).limit(MAX_JOBS);
    if (error) fail('selected runs', error.message);
    const runs = (runData as SelectedRunInput[] | null) ?? [];
    const byRun = new Map<string, SelectedLeadInput[]>();
    // A selected run has no cap on its leads, so read ONE run at a time and page through it (never truncated).
    // Runs are read five at a time so many runs do not fire many requests at once.
    for (const slice of chunk(runs.map((r) => r.id), 5)) {
      await Promise.all(slice.map(async (runId) => {
        const list: SelectedLeadInput[] = [];
        for (let from = 0; ; from += LEAD_PAGE) {
          const { data, error: leadErr } = await supabase.from('autopilot_run_leads')
            .select('run_id, status, email_log_id, updated_at, lead:leads(business_name)')
            .eq('run_id', runId).order('updated_at', { ascending: true }).order('lead_id', { ascending: true })
            .range(from, from + LEAD_PAGE - 1);
          if (leadErr) fail('selected run leads', leadErr.message);
          const rows = (data as unknown as SelectedLeadRow[] | null) ?? [];
          for (const row of rows) list.push({ status: row.status, email_log_id: row.email_log_id, business_name: row.lead?.business_name ?? null, updated_at: row.updated_at });
          if (rows.length < LEAD_PAGE) break;
        }
        byRun.set(runId, list);
      }));
    }
    // Same rule as the sidebar's Autopilot badge: a needs-input lead only needs the user while its parked draft is unsent.
    const logIds = [...byRun.values()].flat().filter((l) => l.status === 'needs_input' && l.email_log_id !== null).map((l) => l.email_log_id as string);
    const logs = await fetchLogStatuses([...new Set(logIds)]);
    if (logs.error) fail('draft statuses', logs.error);
    return runs.map((run) => mapSelectedOutreach(run, byRun.get(run.id) ?? [], logs.statuses));
  },
};

// ---------- Scraper ----------
const scrape: JobSource = {
  kind: 'scrape',
  watch: [{ table: 'scrape_jobs', byOrg: true }, { table: 'raw_leads', byOrg: false }],
  async load(orgId) {
    const { data, error } = await supabase.from('scrape_jobs')
      .select('id, status, icp_raw_input, results_count, approved_count, started_at, completed_at, created_at')
      .eq('org_id', orgId).gte('created_at', sinceIso()).order('created_at', { ascending: false }).limit(MAX_JOBS);
    if (error) fail('scraper jobs', error.message);
    const jobs = (data as ScrapeJobInput[] | null) ?? [];
    // Only completed jobs that produced more results than were approved can still have results waiting.
    const candidates = jobs.filter((j) => j.status === 'completed' && j.results_count > j.approved_count).slice(0, 40);
    const pending = new Map<string, number>();
    await Promise.all(candidates.map(async (job) => {
      const { count, error: countErr } = await supabase.from('raw_leads')
        .select('id', { count: 'exact', head: true }).eq('scrape_job_id', job.id).eq('status', 'pending');
      if (countErr) fail('scraper results', countErr.message);
      pending.set(job.id, count ?? 0);
    }));
    return jobs.map((job) => mapScrape(job, pending.get(job.id) ?? 0));
  },
};

// ---------- Scheduled Autopilot campaign (read-only) ----------
const campaign: JobSource = {
  kind: 'campaign',
  watch: [{ table: 'autopilot_runs', byOrg: true }],
  async load(orgId) {
    const { data, error } = await supabase.from('autopilot_runs')
      .select('id, status, started_at, ends_at, duration_days')
      .eq('org_id', orgId).eq('mode', 'discover').gte('started_at', sinceIso()).order('started_at', { ascending: false }).limit(20);
    if (error) fail('campaigns', error.message);
    const now = new Date();
    return ((data as CampaignRunInput[] | null) ?? []).map((run) => mapCampaign(run, now));
  },
};

export const JOB_SOURCES: JobSource[] = [deepFind, selectedOutreach, scrape, campaign];
