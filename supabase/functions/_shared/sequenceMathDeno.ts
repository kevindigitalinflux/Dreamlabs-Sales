// Deno copy of nextSendAtFor from src/lib/sequenceMath.ts — keep in sync.
function cumulativeDays(steps: { delay_days: number }[], stepNumber: number): number {
  return steps.slice(0, stepNumber).reduce((sum, s) => sum + s.delay_days, 0);
}

/** ISO due time for a 1-based step, or null when past the last step. */
export function nextSendAtForDeno(start: Date, steps: { delay_days: number }[], stepNumber: number): string | null {
  if (stepNumber < 1 || stepNumber > steps.length) return null;
  return new Date(start.getTime() + cumulativeDays(steps, stepNumber) * 86_400_000).toISOString();
}
