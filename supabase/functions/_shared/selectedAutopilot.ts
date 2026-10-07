// Orchestration for selected-leads autopilot: window, claim, caps, outcomes, completion.
// The heavy per-lead work lives in selectedLeadPipeline.ts (Task 12b).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { classifyLead, endOfLocalDay, windowBounds, type EligibilityEnrollment, type EligibilityLead } from './autopilotEligibility.ts';
import { processLeadPipeline, type PipelineContext, type PipelineOutcome } from './selectedLeadPipeline.ts';
import {
  STUCK_SEND_REASON, canStartLead, decideRunState, shouldWaitBetweenLeads, skipReasonFor, stuckRowAction, truncateError, type RunDecision,
} from './selectedAutopilotRules.ts';

export const SEND_GAP_MS = 20000;
export const WALL_BUDGET_MS = 130_000;
export const LEAD_RESERVE_MS = 90_000;
export const LEAD_DEADLINE_MS = 75_000;

export interface SelectedRun {
  id: string; org_id: string; created_by: string; mode: string; status: string; started_at: string;
  window_start: string | null; window_end: string | null; timezone: string | null; window_date: string | null;
  daily_send_cap: number | null; max_total_spend_cents: number | null;
  outreach_sent_total: number; actual_ai_cost_cents: number;
}
interface RunLeadRow { id: string; run_id: string; lead_id: string }
type Bounds = { startUtc: Date; endUtc: Date };

const OUTCOMES = new Set(['sent', 'skipped', 'needs_input', 'failed']);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

function computeBounds(run: SelectedRun): Bounds | null {
  if (!run.window_date || !run.window_start || !run.window_end || !run.timezone) return null;
  try { return windowBounds(run.window_date, run.window_start, run.window_end, run.timezone); } catch { return null; }
}

/** Row update that checks the returned error (supabase-js does not throw). Logs one short line on failure. */
async function updateRow(service: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const { error } = await service.from('autopilot_run_leads').update({ ...patch, updated_at: nowIso() }).eq('id', id);
  if (error) console.error('autopilot_run_leads update failed');
  return !error;
}

async function markQueuedNotReached(service: SupabaseClient, runId: string, reason: string): Promise<void> {
  const { error } = await service.from('autopilot_run_leads')
    .update({ status: 'not_reached', reason, updated_at: nowIso() }).eq('run_id', runId).eq('status', 'queued');
  if (error) console.error('mark not_reached failed');
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
  const { error } = await service.from('autopilot_runs')
    .update({ status: 'completed', ...(note?.cancel ? { cancel_reason: note.cancel } : {}) }).eq('id', runId).eq('status', 'active');
  if (error) console.error('complete run failed');
}

async function cancelRun(service: SupabaseClient, runId: string, reason: string): Promise<void> {
  await markQueuedNotReached(service, runId, reason);
  await service.from('autopilot_runs').update({ status: 'cancelled', cancel_reason: reason }).eq('id', runId).eq('status', 'active');
}

/** Cheap per-lead checks, then the (12b) pipeline. Never trusts the row's own org_id. */
export async function precheckLead(service: SupabaseClient, run: SelectedRun, row: RunLeadRow, hooks: Pick<PipelineContext, 'markSendStarted' | 'reserveSend' | 'releaseSend'>): Promise<PipelineOutcome> {
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

  return processLeadPipeline({
    service, run: { id: run.id, org_id: run.org_id, created_by: run.created_by, timezone: tz }, lead, enrollment, now,
    deadlineMs: Date.now() + LEAD_DEADLINE_MS, ...hooks,
  });
}

/** Saves the outcome (whitelisted), then adds cost. The send slot was already counted by reserveSend. */
async function recordOutcome(service: SupabaseClient, run: SelectedRun, row: RunLeadRow, raw: PipelineOutcome): Promise<void> {
  const out: PipelineOutcome = OUTCOMES.has((raw as { outcome?: string })?.outcome ?? '') ? raw : { outcome: 'failed', reason: 'Unknown pipeline outcome' };
  const reason = out.outcome === 'sent' ? null : String(out.reason ?? '').slice(0, 300) || null;
  const saved = await updateRow(service, row.id, { status: out.outcome, reason, email_log_id: out.emailLogId ?? null, sequence_id: out.sequenceId ?? null });
  if (!saved) await updateRow(service, row.id, { status: 'failed', reason: 'Could not save the result of this lead' });
  const cost = Math.max(0, Math.round(Number(out.costCents ?? 0)) || 0);
  if (cost) {
    const { error } = await service.rpc('autopilot_run_increment', { run_id: run.id, sent: 0, cost_cents: cost });
    if (error) console.error('autopilot_run_increment failed');
  }
}

async function processOne(service: SupabaseClient, run: SelectedRun, row: RunLeadRow): Promise<void> {
  const hooks = {
    async markSendStarted(emailLogId?: string): Promise<void> {
      const ok = await updateRow(service, row.id, { send_started_at: nowIso(), ...(emailLogId ? { email_log_id: emailLogId } : {}) });
      if (!ok) throw new Error('Could not record that the send started');
    },
    async reserveSend(): Promise<boolean> {
      const { data, error } = await service.rpc('autopilot_reserve_send', { run_id: run.id });
      return !error && data === true;
    },
    async releaseSend(): Promise<void> {
      const { error } = await service.rpc('autopilot_release_send', { run_id: run.id });
      if (error) console.error('autopilot_release_send failed');
    },
  };
  let out: PipelineOutcome;
  try { out = await precheckLead(service, run, row, hooks); } catch (e) { out = { outcome: 'failed', reason: truncateError(e) }; }
  try { await recordOutcome(service, run, row, out); } catch (e) {
    await updateRow(service, row.id, { status: 'failed', reason: truncateError(e) });
  }
}

/** Claims ONE queued row just-in-time (oldest first). The conditional update is the double-send guard. */
async function claimOne(service: SupabaseClient, runId: string): Promise<RunLeadRow | null> {
  const { data: queued } = await service.from('autopilot_run_leads').select('id')
    .eq('run_id', runId).eq('status', 'queued').order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(3);
  for (const q of queued ?? []) {
    const ts = nowIso();
    const { data } = await service.from('autopilot_run_leads')
      .update({ status: 'working', claimed_at: ts, updated_at: ts })
      .eq('id', (q as { id: string }).id).eq('status', 'queued').select('id, run_id, lead_id');
    if (data && data.length > 0) return data[0] as RunLeadRow;
  }
  return null;
}

/** Rows stuck `working` >10min: requeue if no send began, otherwise fail (never requeue a possibly-sent row). */
async function recoverStuckRows(service: SupabaseClient, runId: string): Promise<void> {
  const { data } = await service.from('autopilot_run_leads').select('id, claimed_at, send_started_at').eq('run_id', runId).eq('status', 'working');
  const now = new Date();
  for (const r of (data ?? []) as { id: string; claimed_at: string | null; send_started_at: string | null }[]) {
    const action = stuckRowAction(r, now);
    if (action === 'requeue') await service.from('autopilot_run_leads').update({ status: 'queued', claimed_at: null, updated_at: nowIso() }).eq('id', r.id).eq('status', 'working');
    if (action === 'fail') await service.from('autopilot_run_leads').update({ status: 'failed', reason: STUCK_SEND_REASON, updated_at: nowIso() }).eq('id', r.id).eq('status', 'working');
  }
}

/** Fresh read of the run and row counts, then the pure decision. `run` is null when the run is gone or no longer an active selected run. */
async function decide(service: SupabaseClient, runId: string, bounds: Bounds): Promise<{ decision: RunDecision; run: SelectedRun | null }> {
  const { data } = await service.from('autopilot_runs').select('*').eq('id', runId).maybeSingle();
  const fresh = data as SelectedRun | null;
  if (!fresh || fresh.status !== 'active' || fresh.mode !== 'selected') return { decision: 'wait', run: null };
  const [queuedCount, workingCount] = await Promise.all([countRows(service, runId, 'queued'), countRows(service, runId, 'working')]);
  const decision = decideRunState({
    now: new Date(), bounds, runStartedAt: new Date(fresh.started_at), sentTotal: fresh.outreach_sent_total, sendCap: fresh.daily_send_cap,
    spentCents: fresh.actual_ai_cost_cents, spendCap: fresh.max_total_spend_cents, queuedCount, workingCount,
  });
  return { decision, run: fresh };
}

/** Processes one active selected run for one tick. `startedAt` is the invocation start (ms epoch), shared across runs. */
export async function processRun(service: SupabaseClient, run: SelectedRun, startedAt: number): Promise<void> {
  if (run.mode !== 'selected' || run.status !== 'active') return;
  const bounds = computeBounds(run);
  if (!bounds) { await cancelRun(service, run.id, 'Invalid send window'); return; }

  const { data: member } = await service.from('org_members').select('user_id').eq('org_id', run.org_id).eq('user_id', run.created_by).maybeSingle();
  if (!member) { await cancelRun(service, run.id, 'Run creator is no longer a member of this organization'); return; }

  await recoverStuckRows(service, run.id);
  const budget = { budgetMs: WALL_BUDGET_MS, reserveMs: LEAD_RESERVE_MS };
  for (let first = true; ; first = false) {
    const d = await decide(service, run.id, bounds);
    if (!d.run || d.decision === 'wait') return;
    if (d.decision !== 'process') { await finishRun(service, run.id, d.decision); return; }
    if (!canStartLead({ elapsedMs: Date.now() - startedAt, ...budget })) return;
    if (!first) {
      if (!shouldWaitBetweenLeads({ elapsedMs: Date.now() - startedAt, gapMs: SEND_GAP_MS, ...budget })) return;
      await sleep(SEND_GAP_MS);
    }
    const row = await claimOne(service, run.id);
    if (!row) return;
    await processOne(service, d.run, row);
  }
}

/** Tick: every active selected run once. One run's failure never stops the others. */
export async function runTick(service: SupabaseClient, startedAt: number): Promise<number> {
  const { data: runs } = await service.from('autopilot_runs').select('*').eq('status', 'active').eq('mode', 'selected');
  let n = 0;
  for (const r of (runs ?? []) as SelectedRun[]) {
    if (!canStartLead({ elapsedMs: Date.now() - startedAt, budgetMs: WALL_BUDGET_MS, reserveMs: LEAD_RESERVE_MS })) break;
    try { await processRun(service, r, startedAt); n++; } catch { console.error('run-selected-autopilot: run failed'); }
  }
  return n;
}
