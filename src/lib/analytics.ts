import { STAGES, stageInfo } from './utils';
import type { EnrollmentStatus, Lead, LeadNote, Stage } from '../types';

/** Narrow shape of a lead as consumed by this module's compute functions — matches the columns
 *  `useAnalytics` actually selects (not a full `Lead` fetch; see useAnalytics.ts). */
export type AnalyticsLead = Pick<Lead, 'id' | 'stage' | 'vertical' | 'assigned_to' | 'deal_value'>;

/** Narrow shape of a lead note as consumed by this module's compute functions — matches the columns
 *  `useAnalytics` actually selects (not a full `LeadNote` fetch; see useAnalytics.ts). */
export type AnalyticsLeadNote = Pick<LeadNote, 'lead_id' | 'note_type' | 'content' | 'created_at'>;

export type AnalyticsPeriod = 'this_month' | 'last_30_days' | 'all_time';

/** Start of the given period, or null for 'all_time' (no lower bound). */
export function periodStart(period: AnalyticsPeriod, now: Date = new Date()): Date | null {
  if (period === 'all_time') return null;
  if (period === 'last_30_days') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** True if the ISO date falls within [periodStart, now]. */
export function inPeriod(dateISO: string, period: AnalyticsPeriod, now: Date = new Date()): boolean {
  const start = periodStart(period, now);
  const d = new Date(dateISO);
  if (start && d < start) return false;
  return d <= now;
}

export interface StageCount { stage: Stage; count: number; }

/** Snapshot count of leads currently in each pipeline stage, in pipeline order, all 8 always present. */
export function computeLeadsByStage(leads: AnalyticsLead[]): StageCount[] {
  return STAGES.map((s) => ({ stage: s.value, count: leads.filter((l) => l.stage === s.value).length }));
}

export interface VerticalCount { vertical: string; count: number; }

/** Snapshot count of leads by vertical; null groups under "Unspecified"; sorted highest count first. */
export function computeLeadsByVertical(leads: AnalyticsLead[]): VerticalCount[] {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const key = lead.vertical ?? 'Unspecified';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([vertical, count]) => ({ vertical, count })).sort((a, b) => b.count - a.count);
}

export interface ContractorCount { contractorId: string; contractorName: string; count: number; }

/** Snapshot count of leads by assignee; unassigned leads group under contractorId 'unassigned'. */
export function computeLeadsByContractor(leads: AnalyticsLead[], nameFor: (id: string) => string): ContractorCount[] {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const key = lead.assigned_to ?? 'unassigned';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([contractorId, count]) => ({
      contractorId,
      contractorName: contractorId === 'unassigned' ? 'Unassigned' : nameFor(contractorId),
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

const FUNNEL_STAGES: Stage[] = ['contacted', 'audit_booked', 'proposal_sent', 'won'];
const STAGE_CHANGE_PREFIX = 'Stage changed: ';

interface StageChange { toLabel: string; createdAt: string; }

/** Parses "Stage changed: {from} → {to}" general notes (src/lib/leadUpdates.ts) into their target label + timestamp. */
export function parseStageChanges(notes: AnalyticsLeadNote[]): StageChange[] {
  return notes
    .filter((n) => n.note_type === 'general' && n.content.startsWith(STAGE_CHANGE_PREFIX))
    .map((n) => {
      const rest = n.content.slice(STAGE_CHANGE_PREFIX.length);
      const to = rest.split(' → ')[1] ?? '';
      return { toLabel: to.trim(), createdAt: n.created_at };
    });
}

function reachedStage(lead: AnalyticsLead, stage: Stage, changes: StageChange[]): boolean {
  if (lead.stage === stage) return true;
  const label = stageInfo(stage).label;
  return changes.some((c) => c.toLabel === label);
}

export interface FunnelStep { stage: Stage; count: number; conversionFromPrevious: number | null; }

/** Conversion funnel contacted -> audit_booked -> proposal_sent -> won. Snapshot, not period-scoped (see spec).
 *  Monotone by construction: reaching a later funnel stage implies every earlier funnel stage was also reached
 *  (standard funnel semantics), so conversion ratios are always <= 1 even though leads can skip stages via an
 *  ordinary Kanban drag or the stage dropdown (not just a direct database write). */
export function computeFunnel(leads: AnalyticsLead[], notesByLead: Map<string, AnalyticsLeadNote[]>): FunnelStep[] {
  const highestReachedIndex = leads.map((lead) => {
    const changes = parseStageChanges(notesByLead.get(lead.id) ?? []);
    let highest = -1;
    FUNNEL_STAGES.forEach((stage, i) => {
      if (reachedStage(lead, stage, changes)) highest = Math.max(highest, i);
    });
    return highest;
  });
  const counts = FUNNEL_STAGES.map((stage, i) => ({
    stage,
    count: highestReachedIndex.filter((h) => h >= i).length,
  }));
  return counts.map((c, i) => ({
    ...c,
    conversionFromPrevious: i === 0 ? null : counts[i - 1]!.count === 0 ? 0 : c.count / counts[i - 1]!.count,
  }));
}

export interface WonDeals { count: number; totalValue: number; }

/** Leads that transitioned to 'won' within the given period — not leads merely currently 'won' (see spec). */
export function computeWonDeals(
  leads: AnalyticsLead[],
  notesByLead: Map<string, AnalyticsLeadNote[]>,
  period: AnalyticsPeriod,
  now: Date = new Date(),
): WonDeals {
  const wonLabel = stageInfo('won').label;
  let count = 0;
  let totalValue = 0;
  for (const lead of leads) {
    if (lead.stage !== 'won') continue;
    const changes = parseStageChanges(notesByLead.get(lead.id) ?? []);
    const wonInPeriod = changes.some((c) => c.toLabel === wonLabel && inPeriod(c.createdAt, period, now));
    if (wonInPeriod) {
      count += 1;
      totalValue += lead.deal_value ?? 0;
    }
  }
  return { count, totalValue };
}

export interface EmailStats { sent: number; replies: number; replyRate: number; }

/** sent = email_logs with status 'sent' in period; replies = email_replies received in period (activity ratio, not strict cohort attribution — see spec). */
export function computeEmailStats(
  logs: { status: string; sent_at: string }[],
  replies: { received_at: string }[],
  period: AnalyticsPeriod,
  now: Date = new Date(),
): EmailStats {
  const sent = logs.filter((l) => l.status === 'sent' && inPeriod(l.sent_at, period, now)).length;
  const replyCount = replies.filter((r) => inPeriod(r.received_at, period, now)).length;
  return { sent, replies: replyCount, replyRate: sent === 0 ? 0 : replyCount / sent };
}

export interface SequenceStatusCount { status: EnrollmentStatus; count: number; }

const ENROLLMENT_STATUSES: EnrollmentStatus[] = ['active', 'paused', 'completed', 'cancelled'];

/** Snapshot count of sequence enrollments by current status; all 4 statuses always present, possibly 0. */
export function computeSequenceStatusBreakdown(enrollments: { status: EnrollmentStatus }[]): SequenceStatusCount[] {
  return ENROLLMENT_STATUSES.map((status) => ({
    status,
    count: enrollments.filter((e) => e.status === status).length,
  }));
}

/** Count of linkedin_drafts sent within the period. */
export function computeLinkedinSent(
  drafts: { status: string; sent_at: string | null }[],
  period: AnalyticsPeriod,
  now: Date = new Date(),
): number {
  return drafts.filter((d) => d.status === 'sent' && d.sent_at !== null && inPeriod(d.sent_at, period, now)).length;
}

export interface ScraperYield { found: number; approved: number; }

/** Sums results_count/approved_count for scrape_jobs triggered (created_at) within the period. */
export function computeScraperYield(
  jobs: { results_count: number; approved_count: number; created_at: string }[],
  period: AnalyticsPeriod,
  now: Date = new Date(),
): ScraperYield {
  const inRange = jobs.filter((j) => inPeriod(j.created_at, period, now));
  return {
    found: inRange.reduce((sum, j) => sum + j.results_count, 0),
    approved: inRange.reduce((sum, j) => sum + j.approved_count, 0),
  };
}

/** Sums actual_ai_cost_cents for autopilot_runs started within the period (spend-so-far counts toward the start period even if the run is still active). */
export function computeAutopilotSpendCents(
  runs: { actual_ai_cost_cents: number; started_at: string }[],
  period: AnalyticsPeriod,
  now: Date = new Date(),
): number {
  return runs.filter((r) => inPeriod(r.started_at, period, now)).reduce((sum, r) => sum + r.actual_ai_cost_cents, 0);
}
