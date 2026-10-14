// src/lib/jobs/model.ts
// The shared shape of a background job and the pure mappers that turn each existing run type into it.
// Pure on purpose (no React, no Supabase): unit-tested in node. See docs/superpowers/specs/2026-10-14-jobs-tracker-design.md.
import { needsAttention } from '../deepFindView';
import { countOpenNeedsInput } from '../runLeadGroups';

export type JobKind = 'deep_find' | 'selected_outreach' | 'scrape' | 'campaign';
export type JobState = 'needs_you' | 'running' | 'done' | 'failed' | 'stopped';

export interface JobItem {
  id: string;
  kind: JobKind;
  sourceId: string;
  /** Names what the job works on, e.g. "Love Living, FMJ Property +3". */
  title: string;
  /** One plain-words line: progress, what needs the user, or the outcome. */
  detail: string;
  state: JobState;
  progress: { done: number; total: number } | null;
  /** How many items need the user (0 when none). */
  needsYou: number;
  startedAt: string;
  finishedAt: string | null;
  href: string;
  canStop: boolean;
  /** True only for finished, failed or stopped jobs of a kind that may be deleted. */
  canDelete: boolean;
  /** An extra sentence for the delete confirmation, or null. */
  deleteWarning: string | null;
}

export const FINISHED_STATES: readonly JobState[] = ['done', 'failed', 'stopped'];
export const isFinishedState = (state: JobState): boolean => FINISHED_STATES.includes(state);

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Collapses whitespace and cuts to `max` characters with an ellipsis. */
export function shorten(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * "Love Living, FMJ Property +3": the first two names (sorted, case-insensitive) then how many more. `total` is the
 * real number of leads (default: the number of readable names) so leads the viewer cannot name still count.
 */
export function nameLeads(names: Array<string | null | undefined>, total?: number): string {
  const clean = names.map((n) => (n ?? '').trim()).filter((n) => n !== '')
    .sort((a, b) => a.localeCompare(b, 'en-GB', { sensitivity: 'base' }));
  const count = Math.max(total ?? clean.length, clean.length);
  if (clean.length === 0) return count > 0 ? `${count} ${plural(count, 'lead', 'leads')}` : 'No leads yet';
  const shown = clean.slice(0, 2);
  const rest = count - shown.length;
  return rest > 0 ? `${shown.join(', ')} +${rest}` : shown.join(', ');
}

// ---------- Deep find ----------
export interface DeepFindRunInput { id: string; status: 'active' | 'completed' | 'cancelled'; lead_count: number; started_at: string; finished_at: string | null }
export interface DeepFindLeadInput {
  status: 'queued' | 'running' | 'done' | 'failed' | 'skipped';
  people_found: number;
  domains: unknown;
  business_name: string | null;
  company_number: string | null;
}

export function mapDeepFind(run: DeepFindRunInput, leads: DeepFindLeadInput[]): JobItem {
  const needsYou = leads.filter((l) => needsAttention({ status: l.status, domains: l.domains, lead: { company_number: l.company_number } })).length;
  const done = leads.filter((l) => l.status !== 'queued' && l.status !== 'running').length;
  const total = Math.max(run.lead_count, leads.length);
  const people = leads.reduce((sum, l) => sum + (l.people_found || 0), 0);
  const state: JobState = needsYou > 0 ? 'needs_you' : run.status === 'active' ? 'running' : run.status === 'completed' ? 'done' : 'stopped';
  const detail = state === 'needs_you'
    ? `${needsYou} ${plural(needsYou, 'lead needs', 'leads need')} you (choose a company or check people)`
    : state === 'running' ? `${done} of ${total} leads done`
    : state === 'done' ? `${total} ${plural(total, 'lead', 'leads')}, ${people} ${plural(people, 'person', 'people')} added`
    : `Stopped after ${done} of ${total} leads`;
  return {
    id: `deep_find:${run.id}`, kind: 'deep_find', sourceId: run.id,
    title: nameLeads(leads.map((l) => l.business_name), total),
    detail, state, progress: { done, total }, needsYou,
    startedAt: run.started_at, finishedAt: run.finished_at,
    href: `/pipeline/deep-find/${run.id}`,
    canStop: run.status === 'active', canDelete: run.status !== 'active',
    deleteWarning: state === 'needs_you'
      ? 'This job still needs you: deleting it discards those choices. People already added to leads stay.'
      : 'People already added to leads stay.',
  };
}

// ---------- Selected-leads outreach ----------
export interface SelectedRunInput { id: string; status: 'active' | 'completed' | 'cancelled'; started_at: string }
export interface SelectedLeadInput { status: string; email_log_id: string | null; business_name: string | null; updated_at: string }

export function mapSelectedOutreach(run: SelectedRunInput, leads: SelectedLeadInput[], logStatuses: ReadonlyMap<string, string>): JobItem {
  const needsYou = countOpenNeedsInput(leads.map((l) => ({ status: l.status, email_log_id: l.email_log_id })), logStatuses);
  const total = leads.length;
  const done = leads.filter((l) => l.status !== 'queued' && l.status !== 'working').length;
  const sent = leads.filter((l) => l.status === 'sent').length;
  const state: JobState = needsYou > 0 ? 'needs_you' : run.status === 'active' ? 'running' : run.status === 'completed' ? 'done' : 'stopped';
  const detail = state === 'needs_you' ? `${needsYou} ${plural(needsYou, 'draft is', 'drafts are')} waiting for you`
    : state === 'running' ? `${done} of ${total} leads handled`
    : state === 'done' ? `${sent} of ${total} sent`
    : `Stopped after ${done} of ${total}`;
  const newest = leads.reduce<string | null>((max, l) => (max === null || l.updated_at > max ? l.updated_at : max), null);
  return {
    id: `selected_outreach:${run.id}`, kind: 'selected_outreach', sourceId: run.id,
    title: nameLeads(leads.map((l) => l.business_name), total),
    detail, state, progress: { done, total }, needsYou,
    startedAt: run.started_at, finishedAt: run.status === 'active' ? null : (newest ?? run.started_at),
    href: '/outreach/autopilot',
    canStop: run.status === 'active', canDelete: run.status !== 'active',
    deleteWarning: 'Emails already sent and drafts in Emails stay.',
  };
}

// ---------- Scraper ----------
export interface ScrapeJobInput {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  icp_raw_input: string | null;
  results_count: number;
  approved_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export function mapScrape(job: ScrapeJobInput, pendingCount: number): JobItem {
  const startedAt = job.started_at ?? job.created_at;
  const state: JobState = job.status === 'failed' ? 'failed'
    : job.status === 'completed' ? (pendingCount > 0 ? 'needs_you' : 'done') : 'running';
  const detail = state === 'running' ? 'Searching for leads…'
    : state === 'needs_you' ? `${pendingCount} ${plural(pendingCount, 'result', 'results')} to review`
    : state === 'done' ? `${job.results_count} ${plural(job.results_count, 'result', 'results')}, ${job.approved_count} approved`
    : 'The search did not finish';
  return {
    id: `scrape:${job.id}`, kind: 'scrape', sourceId: job.id,
    title: shorten(job.icp_raw_input ?? '', 60) || 'Lead search',
    detail, state, progress: null, needsYou: state === 'needs_you' ? pendingCount : 0,
    startedAt, finishedAt: job.status === 'completed' || job.status === 'failed' ? (job.completed_at ?? startedAt) : null,
    href: `/scraper/jobs/${job.id}`,
    canStop: false, canDelete: job.status === 'completed' || job.status === 'failed',
    deleteWarning: pendingCount > 0
      ? 'Results you have not reviewed go with it. Leads you approved stay in your pipeline.'
      : 'Leads you approved stay in your pipeline.',
  };
}

// ---------- Scheduled Autopilot campaign (read-only) ----------
export interface CampaignRunInput { id: string; status: 'active' | 'completed' | 'cancelled'; started_at: string; ends_at: string | null; duration_days: number | null }

export function mapCampaign(run: CampaignRunInput, now: Date): JobItem {
  const state: JobState = run.status === 'active' ? 'running' : run.status === 'completed' ? 'done' : 'stopped';
  const elapsed = Math.floor((now.getTime() - new Date(run.started_at).getTime()) / 86_400_000) + 1;
  const day = Math.max(1, run.duration_days ? Math.min(run.duration_days, elapsed) : elapsed);
  return {
    id: `campaign:${run.id}`, kind: 'campaign', sourceId: run.id,
    title: 'Autopilot campaign',
    detail: run.duration_days ? `Day ${day} of ${run.duration_days}` : `Day ${day}`,
    state, progress: run.duration_days ? { done: day, total: run.duration_days } : null, needsYou: 0,
    startedAt: run.started_at, finishedAt: run.status === 'active' ? null : (run.ends_at ?? run.started_at),
    href: '/outreach/autopilot', canStop: false, canDelete: false, deleteWarning: null,
  };
}
