import { describe, expect, it } from 'vitest';
import {
  buildDefaultTemplateIdByType,
  decidePostSend,
  describePostSend,
  stepUsesTemplate,
  type EnrollmentLike,
  type SequenceLike,
  type TemplateRef,
} from '../../supabase/functions/_shared/postSendRules';

const NOW = new Date('2026-10-09T10:00:00.000Z');
const DAY = 86_400_000;
const T1: TemplateRef = { id: 't1', template_type: 'intro', is_default: true };
const T2: TemplateRef = { id: 't2', template_type: 'follow_up', is_default: true };
const T3: TemplateRef = { id: 't3', template_type: 'final', is_default: true };
const DEFAULTS = { intro: 't1', follow_up: 't2', final: 't3' };

const cold: SequenceLike = {
  id: 's1',
  name: 'Cold outreach',
  steps: [
    { delay_days: 0, template_type: 'intro' },
    { delay_days: 3, template_type: 'follow_up' },
    { delay_days: 5, template_type: 'final' },
  ],
};
const enr = (over: Partial<EnrollmentLike> = {}): EnrollmentLike => ({
  id: 'e1',
  sequence_id: 's1',
  current_step: 1,
  status: 'active',
  next_send_at: '2026-10-09T10:00:00.000Z',
  ...over,
});
const base = {
  templateId: 't1' as string | null,
  template: T1 as TemplateRef | null,
  enrollment: null as EnrollmentLike | null,
  sequences: [cold],
  defaultTemplateIdByType: DEFAULTS,
  logLinkedToEnrollment: false,
  currentNextActionDate: null as string | null,
  todayLocal: '2026-10-09',
  now: NOW,
  subject: 'Hello there',
  recipientLabel: 'Jane Doe',
};

describe('stepUsesTemplate', () => {
  it('matches by template_id', () => {
    expect(stepUsesTemplate({ template_type: 'x', template_id: 't1' }, T1, DEFAULTS)).toBe(true);
    expect(stepUsesTemplate({ template_type: 'intro', template_id: 'other' }, T1, DEFAULTS)).toBe(false);
  });
  it('matches by type only when the template is the default for that type', () => {
    expect(stepUsesTemplate({ template_type: 'intro' }, T1, DEFAULTS)).toBe(true);
    expect(stepUsesTemplate({ template_type: 'intro', template_id: null }, T1, DEFAULTS)).toBe(true);
    const nonDefault: TemplateRef = { id: 'tx', template_type: 'intro', is_default: false };
    expect(stepUsesTemplate({ template_type: 'intro' }, nonDefault, DEFAULTS)).toBe(false);
    expect(stepUsesTemplate({ template_type: 'follow_up' }, T1, DEFAULTS)).toBe(false);
  });
});

describe('buildDefaultTemplateIdByType', () => {
  it('org default beats global default', () => {
    const map = buildDefaultTemplateIdByType(
      [
        { id: 'g', org_id: null, template_type: 'intro', is_default: true },
        { id: 'o', org_id: 'org1', template_type: 'intro', is_default: true },
        { id: 'n', org_id: 'org1', template_type: 'intro', is_default: false },
      ],
      'org1',
    );
    expect(map).toEqual({ intro: 'o' });
  });
  it('falls back to the global default and ignores other orgs', () => {
    const map = buildDefaultTemplateIdByType(
      [
        { id: 'g', org_id: null, template_type: 'intro', is_default: true },
        { id: 'x', org_id: 'org2', template_type: 'follow_up', is_default: true },
      ],
      'org1',
    );
    expect(map).toEqual({ intro: 'g' });
  });
  it('lets a step resolve to the org default template', () => {
    const map = buildDefaultTemplateIdByType(
      [
        { id: 'g', org_id: null, template_type: 'intro', is_default: true },
        { id: 'o', org_id: 'org1', template_type: 'intro', is_default: true },
      ],
      'org1',
    );
    expect(stepUsesTemplate({ template_type: 'intro' }, { id: 'o', template_type: 'intro', is_default: true }, map)).toBe(true);
    expect(stepUsesTemplate({ template_type: 'intro' }, { id: 'g', template_type: 'intro', is_default: true }, map)).toBe(false);
  });
});

describe('decidePostSend note', () => {
  it('writes the note text', () => {
    expect(decidePostSend(base).note).toBe('Email sent: Hello there (to Jane Doe)');
  });
  it('truncates a long subject to 120 chars', () => {
    const d = decidePostSend({ ...base, subject: 'a'.repeat(300) });
    expect(d.note).toBe(`Email sent: ${'a'.repeat(120)} (to Jane Doe)`);
  });
  it('removes dashes from the subject', () => {
    const d = decidePostSend({ ...base, subject: 'Quick idea — for you' });
    expect(d.note).toBe('Email sent: Quick idea, for you (to Jane Doe)');
  });
});

describe('decidePostSend sequence actions', () => {
  it('advances mid sequence', () => {
    const d = decidePostSend({ ...base, enrollment: enr({ current_step: 1 }) });
    expect(d.action).toBe('advance');
    expect(d.enrollmentId).toBe('e1');
    expect(d.sequenceId).toBe('s1');
    expect(d.expectedCurrentStep).toBe(1);
    expect(d.newCurrentStep).toBe(2);
    expect(d.newStatus).toBe('active');
    expect(d.nextSendAt).toBe(new Date(NOW.getTime() + 3 * DAY).toISOString());
    expect(d.nextAction).toEqual({ set: true, date: '2026-10-12', note: 'Follow up: Cold outreach step 2 of 3' });
  });

  it('completes on the last step', () => {
    const d = decidePostSend({ ...base, template: T3, templateId: 't3', enrollment: enr({ current_step: 3 }) });
    expect(d.action).toBe('advance');
    expect(d.expectedCurrentStep).toBe(3);
    expect(d.newCurrentStep).toBe(3);
    expect(d.newStatus).toBe('completed');
    expect(d.nextSendAt).toBeNull();
    expect(d.nextAction).toEqual({ set: true, date: '2026-10-12', note: 'Follow up after email: Hello there' });
  });

  it('does nothing for an unrelated template on an active enrolment', () => {
    const d = decidePostSend({ ...base, template: T2, templateId: 't2', enrollment: enr({ current_step: 1 }) });
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/current sequence step/);
    expect(d.nextAction.set).toBe(true);
    expect(d.nextAction.note).toBe('Follow up after email: Hello there');
  });

  it('does nothing for a paused enrolment even if one sequence matches', () => {
    const d = decidePostSend({ ...base, enrollment: enr({ status: 'paused' }) });
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/paused/);
  });

  it('enrols after a completed enrolment when the template is in exactly one sequence', () => {
    const d = decidePostSend({ ...base, enrollment: enr({ status: 'completed' }) });
    expect(d.action).toBe('enrol');
    expect(d.sequenceId).toBe('s1');
    expect(d.sequenceName).toBe('Cold outreach');
    expect(d.newCurrentStep).toBe(2);
    expect(d.newStatus).toBe('active');
    expect(d.nextSendAt).toBe(new Date(NOW.getTime() + 3 * DAY).toISOString());
    expect(d.enrollmentId).toBeUndefined();
    expect(d.nextAction).toEqual({ set: true, date: '2026-10-12', note: 'Follow up: Cold outreach step 2 of 3' });
  });

  it('enrols when there is no enrolment and also after a cancelled one', () => {
    expect(decidePostSend(base).action).toBe('enrol');
    expect(decidePostSend({ ...base, enrollment: enr({ status: 'cancelled' }) }).action).toBe('enrol');
  });

  it('enrols from a middle step', () => {
    const d = decidePostSend({ ...base, template: T2, templateId: 't2' });
    expect(d.action).toBe('enrol');
    expect(d.newCurrentStep).toBe(3);
    expect(d.nextSendAt).toBe(new Date(NOW.getTime() + 5 * DAY).toISOString());
  });

  it('does nothing when two sequences contain the template', () => {
    const other: SequenceLike = { id: 's2', name: 'Warm', steps: [{ delay_days: 0, template_type: 'intro' }, { delay_days: 1, template_type: 'final' }] };
    const d = decidePostSend({ ...base, sequences: [cold, other] });
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/more than one sequence/);
  });

  it('does nothing when the template sits at two steps of one sequence', () => {
    const twice: SequenceLike = { id: 's1', name: 'Twice', steps: [{ delay_days: 0, template_type: 'intro' }, { delay_days: 2, template_type: 'intro' }, { delay_days: 2, template_type: 'final' }] };
    const d = decidePostSend({ ...base, sequences: [twice] });
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/more than one step/);
  });

  it('does nothing when the template is the last step', () => {
    const d = decidePostSend({ ...base, template: T3, templateId: 't3' });
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/last step of sequence/);
  });

  it('does nothing when no sequence uses the template', () => {
    const lone: TemplateRef = { id: 'zz', template_type: 'custom', is_default: false };
    const d = decidePostSend({ ...base, template: lone, templateId: 'zz' });
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/no sequence/i);
  });

  it('records the note and default follow up only when there is no template id', () => {
    const d = decidePostSend({ ...base, templateId: null, template: null });
    expect(d.action).toBe('none');
    expect(d.note).toBe('Email sent: Hello there (to Jane Doe)');
    expect(d.nextAction).toEqual({ set: true, date: '2026-10-12', note: 'Follow up after email: Hello there' });
  });

  it('does not advance again when the log is already linked to an enrolment', () => {
    const d = decidePostSend({ ...base, logLinkedToEnrollment: true, enrollment: enr({ current_step: 2, next_send_at: '2026-10-14T09:00:00.000Z' }) });
    expect(d.action).toBe('link_only');
    expect(d.newCurrentStep).toBeUndefined();
    expect(d.nextAction).toEqual({ set: true, date: '2026-10-14', note: 'Follow up: Cold outreach step 2 of 3' });
  });

  it('link_only never enrols when there is no enrolment object', () => {
    const d = decidePostSend({ ...base, logLinkedToEnrollment: true });
    expect(d.action).toBe('link_only');
    expect(d.nextAction.note).toBe('Follow up after email: Hello there');
  });
});

describe('decidePostSend next action date', () => {
  it('preserves a future manual date', () => {
    const d = decidePostSend({ ...base, currentNextActionDate: '2026-10-20' });
    expect(d.nextAction).toEqual({ set: false, date: null, note: null });
    expect(d.action).toBe('enrol');
  });
  it('replaces today and past dates', () => {
    expect(decidePostSend({ ...base, currentNextActionDate: '2026-10-09' }).nextAction.set).toBe(true);
    expect(decidePostSend({ ...base, currentNextActionDate: '2026-10-01' }).nextAction.set).toBe(true);
    expect(decidePostSend({ ...base, currentNextActionDate: '' }).nextAction.set).toBe(true);
  });
  it('uses the supplied toLocalDate for the enrolment date', () => {
    const d = decidePostSend({ ...base, toLocalDate: () => '2026-10-13' });
    expect(d.nextAction.date).toBe('2026-10-13');
  });
  it('rolls the default follow up over months and years', () => {
    const none = { ...base, templateId: null, template: null };
    expect(decidePostSend({ ...none, todayLocal: '2026-12-30' }).nextAction.date).toBe('2027-01-02');
    expect(decidePostSend({ ...none, todayLocal: '2028-02-28' }).nextAction.date).toBe('2028-03-02');
    expect(decidePostSend({ ...none, todayLocal: '2026-10-30', defaultFollowUpDays: 5 }).nextAction.date).toBe('2026-11-04');
  });
});

describe('describePostSend', () => {
  it('describes an advance and follow up', () => {
    const d = decidePostSend({ ...base, enrollment: enr({ current_step: 1 }) });
    expect(describePostSend(d)).toEqual(['Moves the lead to step 2 of Cold outreach', 'Follow-up set for 2026-10-12']);
  });
  it('describes a completion', () => {
    const d = decidePostSend({ ...base, template: T3, templateId: 't3', enrollment: enr({ current_step: 3 }) });
    expect(describePostSend(d)[0]).toBe('Completes the Cold outreach sequence');
  });
  it('describes an enrol', () => {
    expect(describePostSend(decidePostSend(base))[0]).toBe('Enrols the lead in Cold outreach at step 2 of 3');
  });
  it('describes no change and a kept date', () => {
    const d = decidePostSend({ ...base, templateId: null, template: null, currentNextActionDate: '2026-10-20' });
    expect(describePostSend(d)).toEqual(['No sequence change', 'Your existing next action date is kept']);
  });
  it('describes link_only', () => {
    const d = decidePostSend({ ...base, logLinkedToEnrollment: true });
    expect(describePostSend(d)[0]).toBe('Sequence already updated when this draft was made');
  });
});
