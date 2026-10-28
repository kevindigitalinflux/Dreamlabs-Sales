/** Queues survive an explicit pause or user stop; failure/completion queues are terminal. */
export function preservedQueue(run: {status: string; cancel_reason: string | null}): boolean {
  return run.status === 'active' || run.status === 'paused' || (run.status === 'cancelled' && run.cancel_reason === 'stopped by user');
}
/** Explicitly resumed runs wait at their existing window/caps instead of discarding their queue. */
export function resumedDecision<T extends string>(decision: T, resumed: boolean): T | 'wait' {
  return resumed && ['complete_window_closed','complete_send_cap','complete_spend_cap'].includes(decision) ? 'wait' : decision;
}
