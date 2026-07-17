import type { EnrollmentStatus, SequenceEnrollment, SequenceStep } from '../types';

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** Cumulative delay (days) from enrollment start until the given 1-based step. */
function cumulativeDays(steps: SequenceStep[], stepNumber: number): number {
  return steps.slice(0, stepNumber).reduce((sum, s) => sum + s.delay_days, 0);
}

/** ISO due time for a 1-based step, or null when past the last step. */
export function nextSendAtFor(start: Date, steps: SequenceStep[], stepNumber: number): string | null {
  if (stepNumber < 1 || stepNumber > steps.length) return null;
  return addDays(start, cumulativeDays(steps, stepNumber)).toISOString();
}

/** State after drafting the current step: advance or complete. */
export function advanceEnrollment(
  enrollment: Pick<SequenceEnrollment, 'current_step'>,
  steps: SequenceStep[],
  now: Date,
): { current_step: number; next_send_at: string | null; status: EnrollmentStatus } {
  const next = enrollment.current_step + 1;
  if (next > steps.length) {
    return { current_step: enrollment.current_step, next_send_at: null, status: 'completed' };
  }
  return { current_step: next, next_send_at: addDays(now, steps[next - 1]!.delay_days).toISOString(), status: 'active' };
}

/** "Day 0 → Day 2 → Day 9" preview strip for the builder. */
export function timelineLabel(steps: SequenceStep[]): string {
  if (steps.length === 0) return 'No steps yet';
  let total = 0;
  return steps.map((s) => { total += s.delay_days; return `Day ${total}`; }).join(' → ');
}
