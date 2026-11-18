export const WALL_BUDGET_MS = 130_000;
/** A lead is only started when at least this much of the invocation is left. */
export const LEAD_RESERVE_MS = 100_000;
export const FINAL_SAVE_RESERVE_MS = 10_000;
const LEAD_BUDGET_MS = 120_000;

/** Bound lead work by both its own allowance and the invocation's final-save reserve. */
export function leadDeadline(now: number, invocationDeadline = Infinity): number {
  return Math.min(now + LEAD_BUDGET_MS, invocationDeadline - FINAL_SAVE_RESERVE_MS);
}

/** Do not start a role fallback below twenty seconds; leave five seconds after its request. */
export function roleGeminiBudgetMs(leftMs: number): number | null {
  return leftMs < 20000 ? null : Math.min(25000,leftMs-5000);
}
