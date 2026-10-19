// src/lib/jobs/sources.ts
// One adapter per run type. Each loads recent rows for an organisation and maps them to JobItem with the pure mappers
// in ./model. Sub-project C adds a job type by appending one adapter to JOB_SOURCES.
import { supabase } from '../supabase';
import { mapLookupJob, type LookupJobInput, type LookupRowInput } from './lookup';
import { fetchLogStatuses } from '../../hooks/useDraftStatuses';
import type { DeepFindActivityRow } from '../deepFindView';
import { readScrapeGroup } from '../../../supabase/functions/_shared/scrapeGroup';
import {
  mapCampaign, mapDeepFind, mapScrape, mapSelectedOutreach,
  type DeepFindLeadInput, type DeepFindRunInput, type JobItem, type JobKind, type SelectedLeadInput, type SelectedRunInput, type ScrapeJobInput, type CampaignRunInput,
} from './model';

export interface JobSource {
  kind: JobKind;
  /**
   * Tables to listen to for live updates (byOrg: the table has an org_id column the realtime filter can use).
   * Only tables in the `supabase_realtime` publication may be watched: one unpublished table makes Supabase
   * reject the whole channel. Currently published: lookup_jobs, lookup_job_leads, deep_find_runs, deep_find_leads, autopilot_run_leads,
   * scrape_jobs, raw_leads. autopilot_runs is not, so selected runs update through autopilot_run_leads and
   * campaigns through the 30 s refetch.
   */
  watch: Array<{ table: string; byOrg: boolean }>;
  load(orgId: string): Promise<JobItem[]>;
}

/** The table a job of each kind is deleted from (the campaign is read-only and has none). */
export const JOB_TABLE: Partial<Record<JobKind, string>> = {
  deep_find: 'deep_find_runs',
  selected_outreach: 'autopilot_runs',
  scrape: 'scrape_jobs',
  lookup: 'lookup_jobs',
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
  lead: (NonNullable<DeepFindActivityRow['lead']> & { business_name: string | null }) | null;
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
        .select('run_id, status, people_found, domains, lead:leads(business_name, company_number, country, registry_candidates_rejected, dismissed_suggestions, email, additional_emails, contacts:decision_maker_candidates(id, first_name, last_name, email, dismissed_at))')
        .in('run_id', ids).limit(1000);
      if (leadErr) fail('deep find leads', leadErr.message);
      for (const row of (data as unknown as DeepFindLeadRow[] | null) ?? []) {
        const list = byRun.get(row.run_id) ?? [];
        list.push({ status: row.status, people_found: row.people_found, domains: row.domains, business_name: row.lead?.business_name ?? null, company_number: row.lead?.company_number ?? null, review: row.lead });
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
  watch: [{ table: 'autopilot_run_leads', byOrg: true }],
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
      .select('id, status, icp_raw_input, icp_params, sources, results_count, approved_count, created_by, started_at, completed_at, created_at')
      .eq('org_id', orgId).gte('created_at', sinceIso()).order('created_at', { ascending: false }).limit(MAX_JOBS);
    if (error) fail('scraper jobs', error.message);
    const jobs = (data as ScrapeJobInput[] | null) ?? [];
    // Count real results per job for the 40 most recent finished searches with results: approved for all, pending only for
    // searches a person started (Autopilot's daily searches never need the user). Older jobs get an unknown approved count.
    const candidates = jobs.filter((j) => (j.status === 'completed' && j.results_count > 0)
      || (readScrapeGroup(j.icp_params) && (j.status === 'completed' || j.status === 'failed'))).slice(0, 40);
    const pending = new Map<string, number>();
    const approved = new Map<string, number>();
    const countRows = async (jobId: string, status: 'pending' | 'approved'): Promise<number> => {
      const { count, error: countErr } = await supabase.from('raw_leads')
        .select('id', { count: 'exact', head: true }).eq('scrape_job_id', jobId).in('status', status === 'pending' ? ['pending', 'duplicate'] : ['approved']);
      if (countErr) fail('scraper results', countErr.message);
      return count ?? 0;
    };
    await Promise.all(candidates.map(async (job) => {
      const [p, a] = await Promise.all([
        job.created_by !== null ? countRows(job.id, 'pending') : Promise.resolve(0),
        countRows(job.id, 'approved'),
      ]);
      pending.set(job.id, p);
      approved.set(job.id, a);
    }));
    return jobs.map((job) => mapScrape(job, pending.get(job.id) ?? 0, approved.get(job.id)));
  },
};

// ---------- Scheduled Autopilot campaign (read-only) ----------
const campaign: JobSource = {
  kind: 'campaign',
  watch: [],
  async load(orgId) {
    const { data, error } = await supabase.from('autopilot_runs')
      .select('id, status, started_at, ends_at, duration_days')
      .eq('org_id', orgId).eq('mode', 'discover').gte('started_at', sinceIso()).order('started_at', { ascending: false }).limit(20);
    if (error) fail('campaigns', error.message);
    const now = new Date();
    return ((data as CampaignRunInput[] | null) ?? []).map((run) => mapCampaign(run, now));
  },
};

const lookup: JobSource = {
  kind: 'lookup',
  watch: [{ table: 'lookup_jobs', byOrg: true }, { table: 'lookup_job_leads', byOrg: true }],
  async load(orgId) {
    const { data, error } = await supabase.from('lookup_jobs').select('id, org_id, created_by, kind, status, lead_count, created_at, finished_at')
      .eq('org_id', orgId).gte('created_at', sinceIso()).order('created_at', { ascending: false }).limit(MAX_JOBS);
    if (error) fail('lookups', error.message);
    const jobs = (data ?? []) as LookupJobInput[];
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) fail('lookup permissions', 'Sign in to see lookups');
    const { data: member, error: memberError } = await supabase.from('org_members').select('role').eq('org_id', orgId).eq('user_id', auth.user.id).maybeSingle();
    if (memberError || !member) fail('lookup permissions', 'Organisation membership unavailable');
    const byJob = new Map<string, Array<LookupRowInput & { lead: { business_name: string } | null }>>();
    // At most 50 leads/job: 20 jobs fit the server's 1000-row limit without truncation.
    for (const ids of chunk(jobs.map((j) => j.id), 20)) {
      const { data: rows, error: rowError } = await supabase.from('lookup_job_leads')
        .select('job_id, status, review, lead:leads(business_name)').in('job_id', ids).eq('org_id', orgId).order('id').limit(1000);
      if (rowError) fail('lookup results', rowError.message);
      for (const row of (rows ?? []) as unknown as Array<LookupRowInput & { job_id: string; lead: { business_name: string } | null }>) {
        const list = byJob.get(row.job_id) ?? [];
        list.push(row); byJob.set(row.job_id, list);
      }
    }
    return jobs.map((job) => {
      const rows = byJob.get(job.id) ?? [];
      return mapLookupJob(job, rows, rows.map((r) => r.lead?.business_name ?? null), { userId: auth.user.id, isAdmin: member.role === 'admin' });
    });
  },
};

export const JOB_SOURCES: JobSource[] = [deepFind, selectedOutreach, scrape, campaign, lookup];
