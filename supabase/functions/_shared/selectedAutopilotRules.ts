// Pure decision helpers for the selected-leads autopilot engine.
// No imports: shared by Vitest (src/lib tests) and the Deno edge function.

export const MAX_ERROR_LENGTH = 300;
export const STUCK_AFTER_MS = 10 * 60 * 1000;
export const NEW_RUN_GRACE_MS = 60 * 1000;
export const STUCK_SEND_REASON = 'Interrupted during send. Check Email logs before retrying.';

const SKIP_REASONS: Record<string, string> = {
  opted_out: 'Lead has opted out of emails',
  blocked: 'Lead is on the blocklist',
  closed: 'Lead is already won or lost',
  paused: 'Lead is in a paused sequence',
  not_due: 'Already in a sequence and not due today',
  recently_contacted: 'Contacted recently and not due',
};

/** Plain-English skip reason for an ineligible `classifyLead` reason code. */
export function skipReasonFor(reason: string): string {
  return SKIP_REASONS[reason] ?? 'Lead is not eligible right now';
}

export type RunDecision = 'wait' | 'process' | 'complete_window_closed' | 'complete_send_cap' | 'complete_spend_cap' | 'complete_no_leads';

export interface RunStateInput {
  now: Date;
  bounds: { startUtc: Date; endUtc: Date };
  /** When the run row was created; a run with no leads is only "done" once it is older than 60s (leads are inserted after the run). */
  runStartedAt: Date;
  sentTotal: number;
  sendCap: number | null;
  spentCents: number;
  spendCap: number | null;
  queuedCount: number;
  workingCount: number;
}

/**
 * What a tick should do with a run. Order: window closed (end exclusive, same as inWindow),
 * before window, send cap, spend cap, nothing left to do (after a 60s creation grace), otherwise process.
 * A null cap means unlimited.
 */
export function decideRunState(i: RunStateInput): RunDecision {
  const t = i.now.getTime();
  if (t >= i.bounds.endUtc.getTime()) return 'complete_window_closed';
  if (t < i.bounds.startUtc.getTime()) return 'wait';
  if (i.sendCap != null && i.sentTotal >= i.sendCap) return 'complete_send_cap';
  if (i.spendCap != null && i.spentCents >= i.spendCap) return 'complete_spend_cap';
  if (i.queuedCount === 0 && i.workingCount === 0) {
    return t - i.runStartedAt.getTime() > NEW_RUN_GRACE_MS ? 'complete_no_leads' : 'wait';
  }
  return 'process';
}

/** Short, secret-free error text for a row's reason column (message only, never a stack). */
export function truncateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return (msg.trim() || 'Unexpected error').slice(0, MAX_ERROR_LENGTH);
}

/** True when a new lead can start: its reserved time still fits in the invocation's wall-clock budget. */
export function canStartLead(p: { elapsedMs: number; budgetMs: number; reserveMs: number }): boolean {
  return p.elapsedMs + p.reserveMs <= p.budgetMs;
}

/** True when it is worth sleeping the send gap: after the gap the next lead must still fit in the budget. */
export function shouldWaitBetweenLeads(p: { elapsedMs: number; budgetMs: number; gapMs: number; reserveMs: number }): boolean {
  return canStartLead({ elapsedMs: p.elapsedMs + p.gapMs, budgetMs: p.budgetMs, reserveMs: p.reserveMs });
}

/**
 * What to do with a row sitting in `working`. Rows older than 10 minutes are stuck: if a send never began they are
 * safe to requeue; if the send marker is set the email may have gone out, so they must NEVER be requeued.
 */
export function stuckRowAction(row: { claimed_at: string | null; send_started_at: string | null }, now: Date): 'ignore' | 'requeue' | 'fail' {
  if (row.claimed_at && now.getTime() - new Date(row.claimed_at).getTime() <= STUCK_AFTER_MS) return 'ignore';
  return row.send_started_at ? 'fail' : 'requeue';
}
