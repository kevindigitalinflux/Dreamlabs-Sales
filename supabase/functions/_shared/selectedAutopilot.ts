// Orchestration for selected-leads autopilot: window, claim, caps, outcomes, completion.
// The heavy per-lead work lives in selectedLeadPipeline.ts (Task 12b).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { classifyLead, endOfLocalDay, windowBounds, type EligibilityEnrollment, type EligibilityLead } from './autopilotEligibility.ts';
import { processLeadPipeline, type PipelineOutcome } from './selectedLeadPipeline.ts';
import { decideRunState, shouldWaitBetweenLeads, skipReasonFor, truncateError, type RunDecision } from './selectedAutopilotRules.ts';

export const SEND_GAP_MS = 20000;
export const BUDGET_MS = 120000;
export const BATCH_SIZE = 3;
export const STUCK_AFTER_MS = 10 * 60 * 1000;

export interface SelectedRun {
  id: string; org_id: string; created_by: string; mode: string; status: string;
  window_start: string | null; window_end: string | null; timezone: string | null; window_date: string | null;
  daily_send_cap: number | null; max_total_spend_cents: number | null;
  outreach_sent_total: number; actual_ai_cost_cents: number;
}
interface RunLeadRow { id: string; run_id: string; lead_id: string }
type Bounds = { startUtc: Date; endUtc: Date };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

function computeBounds(run: SelectedRun): Bounds | null {
  if (!run.window_date || !run.window_start || !run.window_end || !run.timezone) return null;
  try { return windowBounds(run.window_date, run.window_start, run.window_end, run.timezone); } catch { return null; }
}

async function markQueuedNotReached(service: SupabaseClient, runId: string, reason: string): Promise<void> {
  await service.from('autopilot_run_leads')
    .update({ status: 'not_reached', reason, updated_at: nowIso() })
    .eq('run_id', runId).eq('status', 'queued');
}

async function releaseRows(service: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await service.from('autopilot_run_leads')
    .update({ status: 'queued', claimed_at: null, updated_at: nowIso() })
    .in('id', ids).eq('status', 'working');
}

async function countRows(service: SupabaseClient, runId: string, status: string): Promise<number> {
  const { count } = await service.from('autopilot_run_leads').select('id', { count: 'exact', head: true }).eq('run_id', runId).eq('status', status);
  return count ?? 0;
}

const FINISH_NOTES: Partial<Record<RunDecision, { reason: string; cancel?: string }>> = {
  complete_window_closed: { reason: 'Finish time reached before this lead was reached' },
  complete_send_cap: { reason: 'Daily send cap reached', cancel: 'Daily send cap reached' },
  complete_spend_cap: { reason: 'Spend cap reached', cancel: 'Spend cap reached' },
};

/** Marks remaining queued rows not_reached and completes the run (only if it is still active). */
async function finishRun(service: SupabaseClient, runId: string, decision: RunDecision): Promise<void> {
  const note = FINISH_NOTES[decision];
  if (note) await markQueuedNotReached(service, runId, note.reason);
  await service.from('autopilot_runs')
    .update({ status: 'completed', ...(note?.cancel ? { cancel_reason: note.cancel } : {}) })
    .eq('id', runId).eq('status', 'active');
}

/** Cheap per-lead checks, then the (12b) pipeline. Never trusts the row's own org_id. */
export async function precheckLead(service: SupabaseClient, run: SelectedRun, row: RunLeadRow): Promise<PipelineOutcome> {
  const { data } = await service.from('leads').select('*').eq('id', row.lead_id).maybeSingle();
  const lead = data as (Record<string, unknown> & { id: string; org_id: string }) | null;
  if (!lead) return { outcome: 'skipped', reason: 'Lead no longer exists' };
  if (lead.org_id !== run.org_id) return { outcome: 'skipped', reason: 'Lead is not in this organization' };

  const { data: enr } = await service.from('sequence_enrollments').select('*')
    .eq('lead_id', lead.id).in('status', ['active', 'paused']).order('created_at', { ascending: false }).limit(1);
  const enrollment = ((enr ?? [])[0] ?? null) as (EligibilityEnrollment & { id?: string; sequence_id?: string; current_step?: number }) | null;
  const { data: bl } = await service.from('outreach_blocklist').select('value').eq('org_id', run.org_id);
  const blocked = new Set((bl ?? []).map((b) => String((b as { value: string }).value)));

  const now = new Date();
  const tz = run.timezone ?? 'Europe/London';
  const verdict = classifyLead(lead as unknown as EligibilityLead, enrollment, blocked, endOfLocalDay(now, tz), now);
  if (!verdict.eligible) return { outcome: 'skipped', reason: skipReasonFor(verdict.reason) };

  return processLeadPipeline({ service, run: { id: run.id, org_id: run.org_id, created_by: run.created_by, timezone: tz }, lead, enrollment, now });
}

async function recordOutcome(service: SupabaseClient, run: SelectedRun, row: RunLeadRow, out: PipelineOutcome): Promise<void> {
  const reason = out.outcome === 'sent' ? null : out.reason;
  await service.from('autopilot_run_leads').update({
    status: out.outcome, reason, email_log_id: out.emailLogId ?? null, sequence_id: out.sequenceId ?? null, updated_at: nowIso(),
  }).eq('id', row.id);
  const sent = out.outcome === 'sent' ? 1 : 0;
  const cost = Math.max(0, Math.round(out.costCents ?? 0));
  if (sent || cost) {
    const { error } = await service.rpc('autopilot_run_increment', { run_id: run.id, sent, cost_cents: cost });
    if (error) console.error('autopilot_run_increment failed');
  }
}

async function processOne(service: SupabaseClient, run: SelectedRun, row: RunLeadRow): Promise<void> {
  let out: PipelineOutcome;
  try { out = await precheckLead(service, run, row); } catch (e) { out = { outcome: 'failed', reason: truncateError(e) }; }
  try { await recordOutcome(service, run, row, out); } catch (e) {
    await service.from('autopilot_run_leads').update({ status: 'failed', reason: truncateError(e), updated_at: nowIso() }).eq('id', row.id);
  }
}

async function claimBatch(service: SupabaseClient, runId: string): Promise<RunLeadRow[]> {
  const { data: queued } = await service.from('autopilot_run_leads').select('id')
    .eq('run_id', runId).eq('status', 'queued').order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(BATCH_SIZE);
  const claimed: RunLeadRow[] = [];
  for (const q of queued ?? []) {
    const ts = nowIso();
    // Atomic claim: only one tick can flip queued to working. This is the double-send guard.
    const { data } = await service.from('autopilot_run_leads')
      .update({ status: 'working', claimed_at: ts, updated_at: ts })
      .eq('id', (q as { id: string }).id).eq('status', 'queued').select('id, run_id, lead_id');
    if (data && data.length > 0) claimed.push(data[0] as RunLeadRow);
  }
  return claimed;
}

/** Fresh read of the run and row counts, then the pure decision. `run` is null when the run is gone or no longer an active selected run. */
async function decide(service: SupabaseClient, runId: string, bounds: Bounds): Promise<{ decision: RunDecision; run: SelectedRun | null }> {
  const { data } = await service.from('autopilot_runs').select('*').eq('id', runId).maybeSingle();
  const fresh = data as SelectedRun | null;
  if (!fresh || fresh.status !== 'active' || fresh.mode !== 'selected') return { decision: 'wait', run: null };
  const [queuedCount, workingCount] = await Promise.all([countRows(service, runId, 'queued'), countRows(service, runId, 'working')]);
  const decision = decideRunState({
    now: new Date(), bounds, sentTotal: fresh.outreach_sent_total, sendCap: fresh.daily_send_cap,
    spentCents: fresh.actual_ai_cost_cents, spendCap: fresh.max_total_spend_cents, queuedCount, workingCount,
  });
  return { decision, run: fresh };
}

/** Processes one active selected run for one tick. `startedAt` is the invocation start (ms epoch) for the wall-clock budget. */
export async function processRun(service: SupabaseClient, run: SelectedRun, startedAt: number): Promise<void> {
  if (run.mode !== 'selected' || run.status !== 'active') return;
  const bounds = computeBounds(run);
  if (!bounds) {
    await markQueuedNotReached(service, run.id, 'Invalid send window');
    await service.from('autopilot_runs').update({ status: 'cancelled', cancel_reason: 'Invalid send window' }).eq('id', run.id).eq('status', 'active');
    return;
  }
  await service.from('autopilot_run_leads')
    .update({ status: 'queued', claimed_at: null, updated_at: nowIso() })
    .eq('run_id', run.id).eq('status', 'working').lt('claimed_at', new Date(Date.now() - STUCK_AFTER_MS).toISOString());

  const first = await decide(service, run.id, bounds);
  if (!first.run || first.decision === 'wait') return;
  if (first.decision !== 'process') { await finishRun(service, run.id, first.decision); return; }

  const claimed = await claimBatch(service, run.id);
  for (let i = 0; i < claimed.length; i++) {
    // Caps and window re-checked from a fresh read before EVERY lead.
    const check = await decide(service, run.id, bounds);
    // After our own claim there is at least one working row (ours), so complete_no_leads cannot occur here.
    if (!check.run || check.decision !== 'process') {
      await releaseRows(service, claimed.slice(i).map((r) => r.id));
      if (check.run && check.decision !== 'wait') await finishRun(service, run.id, check.decision);
      return;
    }
    await processOne(service, check.run, claimed[i]!);
    const remaining = claimed.length - i - 1;
    if (remaining > 0) {
      if (shouldWaitBetweenLeads({ remainingClaimed: remaining, elapsedMs: Date.now() - startedAt, budgetMs: BUDGET_MS, gapMs: SEND_GAP_MS })) await sleep(SEND_GAP_MS);
      else { await releaseRows(service, claimed.slice(i + 1).map((r) => r.id)); return; }
    }
  }
  const after = await decide(service, run.id, bounds);
  if (after.run && after.decision !== 'process' && after.decision !== 'wait') await finishRun(service, run.id, after.decision);
}

/** Tick: every active selected run once. One run's failure never stops the others. */
export async function runTick(service: SupabaseClient, startedAt: number): Promise<number> {
  const { data: runs } = await service.from('autopilot_runs').select('*').eq('status', 'active').eq('mode', 'selected');
  let n = 0;
  for (const r of (runs ?? []) as SelectedRun[]) {
    try { await processRun(service, r, startedAt); n++; } catch { console.error('run-selected-autopilot: run failed'); }
  }
  return n;
}
