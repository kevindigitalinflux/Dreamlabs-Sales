import { describe, expect, it } from 'vitest';
import { advanceEnrollment, nextSendAtFor, timelineLabel } from './sequenceMath';
import type { SequenceStep } from '../types';

const steps: SequenceStep[] = [
  { delay_days: 0, template_type: 'initial_followup', subject_override: null },
  { delay_days: 2, template_type: 'second_chase', subject_override: null },
  { delay_days: 7, template_type: 'proposal_followup', subject_override: null },
];
const T0 = new Date('2026-07-17T06:00:00Z');

describe('nextSendAtFor', () => {
  it('step 1 due at start + its own delay', () => {
    expect(nextSendAtFor(T0, steps, 1)).toBe('2026-07-17T06:00:00.000Z');
  });
  it('step 2 due at cumulative delay', () => {
    expect(nextSendAtFor(T0, steps, 2)).toBe('2026-07-19T06:00:00.000Z');
  });
  it('step 3 cumulative 0+2+7 = day 9', () => {
    expect(nextSendAtFor(T0, steps, 3)).toBe('2026-07-26T06:00:00.000Z');
  });
  it('null beyond the last step', () => {
    expect(nextSendAtFor(T0, steps, 4)).toBeNull();
  });
});

describe('advanceEnrollment', () => {
  it('moves to the next step, due now + its delay', () => {
    const r = advanceEnrollment({ current_step: 1 }, steps, T0);
    expect(r).toEqual({ current_step: 2, next_send_at: '2026-07-19T06:00:00.000Z', status: 'active' });
  });
  it('completes after the last step', () => {
    const r = advanceEnrollment({ current_step: 3 }, steps, T0);
    expect(r).toEqual({ current_step: 3, next_send_at: null, status: 'completed' });
  });
});

describe('timelineLabel', () => {
  it('renders cumulative day markers', () => {
    expect(timelineLabel(steps)).toBe('Day 0 → Day 2 → Day 9');
  });
  it('empty steps', () => {
    expect(timelineLabel([])).toBe('No steps yet');
  });
});
