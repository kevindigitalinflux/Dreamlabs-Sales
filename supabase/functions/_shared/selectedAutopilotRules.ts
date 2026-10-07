// Pure decision helpers for the selected-leads autopilot engine.
// No imports: shared by Vitest (src/lib tests) and the Deno edge function.

export const MAX_ERROR_LENGTH = 300;

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
  sentTotal: number;
  sendCap: number | null;
  spentCents: number;
  spendCap: number | null;
  queuedCount: number;
  workingCount: number;
}

/**
 * What a tick should do with a run. Order: window closed, before window, send cap,
 * spend cap, nothing left to do, otherwise process. A null cap means unlimited.
 */
export function decideRunState(i: RunStateInput): RunDecision {
  if (i.now.getTime() > i.bounds.endUtc.getTime()) return 'complete_window_closed';
  if (i.now.getTime() < i.bounds.startUtc.getTime()) return 'wait';
  if (i.sendCap != null && i.sentTotal >= i.sendCap) return 'complete_send_cap';
  if (i.spendCap != null && i.spentCents >= i.spendCap) return 'complete_spend_cap';
  if (i.queuedCount === 0 && i.workingCount === 0) return 'complete_no_leads';
  return 'process';
}

/** Short, secret-free error text for a row's reason column (message only, never a stack). */
export function truncateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return (msg.trim() || 'Unexpected error').slice(0, MAX_ERROR_LENGTH);
}

/** True when there is another claimed lead to process and the gap still fits in the wall-clock budget. */
export function shouldWaitBetweenLeads(p: { remainingClaimed: number; elapsedMs: number; budgetMs: number; gapMs: number }): boolean {
  return p.remainingClaimed > 0 && p.elapsedMs + p.gapMs < p.budgetMs;
}
