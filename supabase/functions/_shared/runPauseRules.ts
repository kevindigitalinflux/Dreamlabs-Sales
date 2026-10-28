import { localDateString, windowBounds } from './autopilotEligibility.ts';
import { decideRunState, type RunStateInput, type RunDecision } from './selectedAutopilotRules.ts';

/** Queues survive an explicit pause or user stop; failure/completion queues are terminal. */
export function preservedQueue(run: {status: string; cancel_reason: string | null}): boolean {
  return run.status === 'active' || run.status === 'paused' || (run.status === 'cancelled' && run.cancel_reason === 'stopped by user');
}
/** Explicitly resumed runs wait for another window; unchanged cumulative caps still finish the run. */
export function resumedDecision<T extends string>(decision: T, resumed: boolean): T | 'wait' {
  return resumed && decision === 'complete_window_closed' ? 'wait' : decision;
}

/** A resumed cap must finish even when the ordinary decision prioritises a closed window. */
export function selectedRunDecision(input: RunStateInput, resumed: boolean): RunDecision {
  if (resumed) {
    if (input.sendCap != null && input.sentTotal >= input.sendCap) return 'complete_send_cap';
    if (input.spendCap != null && input.spentCents >= input.spendCap) return 'complete_spend_cap';
  }
  return resumedDecision(decideRunState(input), resumed);
}

/** Engine and UI use the same local date and timezone when reopening a run's window. */
export function selectedRunBounds(run: {
  resumed_at?: string | null; window_date: string | null; window_start: string | null;
  window_end: string | null; timezone: string | null;
}, now = new Date()): {startUtc: Date; endUtc: Date} | null {
  if (!run.window_start || !run.window_end) return null;
  const timezone = run.timezone ?? 'Europe/London';
  try {
    const date = run.resumed_at ? localDateString(now, timezone) : run.window_date;
    return date ? windowBounds(date, run.window_start, run.window_end, timezone) : null;
  } catch {
    console.error('autopilot: could not calculate the run window');
    return null;
  }
}
