import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import { useProfiles } from './useProfiles';
import {
  computeAutopilotSpendCents, computeEmailStats, computeFunnel, computeLeadsByContractor,
  computeLeadsByStage, computeLeadsByVertical, computeLinkedinSent, computeScraperYield,
  computeSequenceStatusBreakdown, computeWonDeals,
} from '../lib/analytics';
import type {
  AnalyticsLead, AnalyticsLeadNote, AnalyticsPeriod, ContractorCount, EmailStats, FunnelStep,
  ScraperYield, SequenceStatusCount, StageCount, VerticalCount, WonDeals,
} from '../lib/analytics';
import type { EnrollmentStatus } from '../types';

export interface AnalyticsData {
  leadsByStage: StageCount[];
  funnel: FunnelStep[];
  wonDeals: WonDeals;
  leadsByVertical: VerticalCount[];
  leadsByContractor: ContractorCount[] | null; // null for non-admins
  emailStats: EmailStats;
  sequenceStatusBreakdown: SequenceStatusCount[];
  linkedinSent: number;
  scraperYield: ScraperYield;
  autopilotSpendCents: number;
}

interface RawData {
  leads: AnalyticsLead[];
  notesByLead: Map<string, AnalyticsLeadNote[]>;
  emailLogs: { status: string; sent_at: string }[];
  emailReplies: { received_at: string }[];
  enrollments: { status: EnrollmentStatus }[];
  linkedinDrafts: { status: string; sent_at: string | null }[];
  scrapeJobs: { results_count: number; approved_count: number; created_at: string }[];
  autopilotRuns: { actual_ai_cost_cents: number; started_at: string }[];
}

/**
 * Org-scoped analytics for the selected period. Fetches raw rows once per org (not per period —
 * every query already reads exactly what each table's RLS returns for the caller: org-wide for
 * admins, own-rows-only for non-admins on leads/email_logs/sequence_enrollments/scrape_jobs/lead_notes
 * (scoped via its parent `leads` row, same as sequence_enrollments); already org-wide for everyone on
 * linkedin_drafts/autopilot_runs; email_replies is joined through email_logs (`email_logs!inner(id)`)
 * so it inherits email_logs' own-rows-only-for-non-admins visibility too, matching the population
 * `emailStats.sent` is drawn from — see docs/superpowers/specs/2026-09-08-analytics-design.md §3),
 * then recomputes via useMemo whenever the period changes, with no additional network round-trip.
 */
export function useAnalytics(period: AnalyticsPeriod) {
  const { currentOrg } = useOrg();
  const { profiles } = useProfiles();
  const [raw, setRaw] = useState<RawData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrg) { setRaw(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    void (async () => {
      const [leadsRes, notesRes, logsRes, repliesRes, enrollmentsRes, draftsRes, jobsRes, runsRes] = await Promise.all([
        supabase.from('leads').select('id, stage, vertical, assigned_to, deal_value').eq('org_id', currentOrg.id),
        supabase.from('lead_notes').select('lead_id, note_type, content, created_at, leads!inner(org_id)').eq('leads.org_id', currentOrg.id),
        supabase.from('email_logs').select('status, sent_at').eq('org_id', currentOrg.id),
        supabase.from('email_replies').select('received_at, email_logs!inner(id)').eq('org_id', currentOrg.id),
        supabase.from('sequence_enrollments').select('status, leads!inner(org_id)').eq('leads.org_id', currentOrg.id),
        supabase.from('linkedin_drafts').select('status, sent_at').eq('org_id', currentOrg.id),
        supabase.from('scrape_jobs').select('results_count, approved_count, created_at').eq('org_id', currentOrg.id),
        supabase.from('autopilot_runs').select('actual_ai_cost_cents, started_at').eq('org_id', currentOrg.id),
      ]);

      const firstError = leadsRes.error ?? notesRes.error ?? logsRes.error ?? repliesRes.error
        ?? enrollmentsRes.error ?? draftsRes.error ?? jobsRes.error ?? runsRes.error;
      if (firstError) {
        if (!cancelled) { setError(firstError.message); setLoading(false); }
        return;
      }

      const leads = (leadsRes.data ?? []) as AnalyticsLead[];

      const notesByLead = new Map<string, AnalyticsLeadNote[]>();
      for (const note of (notesRes.data ?? []) as AnalyticsLeadNote[]) {
        const existing = notesByLead.get(note.lead_id) ?? [];
        existing.push(note);
        notesByLead.set(note.lead_id, existing);
      }

      if (cancelled) return;
      setRaw({
        leads,
        notesByLead,
        emailLogs: (logsRes.data ?? []) as { status: string; sent_at: string }[],
        emailReplies: ((repliesRes.data ?? []) as { received_at: string }[]).map((r) => ({ received_at: r.received_at })),
        enrollments: (enrollmentsRes.data ?? []) as { status: EnrollmentStatus }[],
        linkedinDrafts: (draftsRes.data ?? []) as { status: string; sent_at: string | null }[],
        scrapeJobs: (jobsRes.data ?? []) as { results_count: number; approved_count: number; created_at: string }[],
        autopilotRuns: (runsRes.data ?? []) as { actual_ai_cost_cents: number; started_at: string }[],
      });
      setError(null);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [currentOrg]);

  const data = useMemo<AnalyticsData | null>(() => {
    if (!raw || !currentOrg) return null;
    return {
      leadsByStage: computeLeadsByStage(raw.leads),
      funnel: computeFunnel(raw.leads, raw.notesByLead),
      wonDeals: computeWonDeals(raw.leads, raw.notesByLead, period),
      leadsByVertical: computeLeadsByVertical(raw.leads),
      leadsByContractor: currentOrg.role === 'admin'
        ? computeLeadsByContractor(raw.leads, (id) => profiles.find((p) => p.id === id)?.full_name ?? profiles.find((p) => p.id === id)?.email ?? id)
        : null,
      emailStats: computeEmailStats(raw.emailLogs, raw.emailReplies, period),
      sequenceStatusBreakdown: computeSequenceStatusBreakdown(raw.enrollments),
      linkedinSent: computeLinkedinSent(raw.linkedinDrafts, period),
      scraperYield: computeScraperYield(raw.scrapeJobs, period),
      autopilotSpendCents: computeAutopilotSpendCents(raw.autopilotRuns, period),
    };
  }, [raw, period, currentOrg, profiles]);

  return { data, loading, error };
}
