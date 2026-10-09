import { describe, expect, it } from 'vitest';
import { enrollmentsDiffer, missingStepId, pickerOptions, resolveLeadTemplate } from './templatePicker';
import type { PickerEnrollment, PickerSequence, PickerTemplate } from './templatePicker';

const tpl = (id: string, name: string, type = 'custom', is_default = false): PickerTemplate => ({ id, name, template_type: type, is_default });
const templates = [tpl('t-intro', 'Intro', 'intro', true), tpl('t-fu', 'Follow up', 'follow_up', true), tpl('t-own', 'My own'), tpl('t-extra', 'Extra')];
const defaults = { intro: 't-intro', follow_up: 't-fu' };
const seq: PickerSequence = {
  id: 's1', name: 'Cold outreach',
  steps: [{ template_type: 'intro' }, { template_type: 'custom', template_id: 't-own' }, { template_type: 'follow_up' }],
};
const enr = (current_step: number, status = 'active'): PickerEnrollment => ({ sequence_id: 's1', current_step, status });
const base = { templates, sequences: [seq], defaultTemplateIdByType: defaults, showAll: false };

describe('pickerOptions', () => {
  it('lists only the sequence templates in step order, pre-selecting the current step', () => {
    expect(pickerOptions({ ...base, enrollment: enr(2) })).toEqual({
      options: [
        { id: 't-intro', label: 'Step 1: Intro', group: 'sequence' },
        { id: 't-own', label: 'Step 2: My own (current)', group: 'sequence', current: true },
        { id: 't-fu', label: 'Step 3: Follow up', group: 'sequence' },
      ],
      selectedId: 't-own', sequenceName: 'Cold outreach', currentStep: 2, totalSteps: 3,
    });
  });

  it('adds the remaining templates under other when showAll', () => {
    const r = pickerOptions({ ...base, enrollment: enr(1), showAll: true });
    expect(r.options.map((o) => [o.id, o.group])).toEqual([
      ['t-intro', 'sequence'], ['t-own', 'sequence'], ['t-fu', 'sequence'], ['t-extra', 'other'],
    ]);
    expect(r.selectedId).toBe('t-intro');
  });

  it.each([
    ['no enrolment', null],
    ['paused', enr(2, 'paused')],
    ['completed', enr(3, 'completed')],
    ['cancelled', enr(1, 'cancelled')],
  ])('behaves as today for %s', (_name, enrollment) => {
    expect(pickerOptions({ ...base, enrollment })).toEqual({
      options: templates.map((t) => ({ id: t.id, label: t.name, group: 'other' })),
      selectedId: null, sequenceName: null, currentStep: null, totalSteps: null,
    });
  });

  it('treats an enrolment on a deleted sequence as none', () => {
    const r = pickerOptions({ ...base, sequences: [], enrollment: enr(1) });
    expect(r.sequenceName).toBeNull();
    expect(r.selectedId).toBeNull();
    expect(r.options).toHaveLength(4);
  });

  it('shows a step whose template cannot be found as disabled and selects nothing when it is current', () => {
    const broken: PickerSequence = { id: 's1', name: 'Cold outreach', steps: [{ template_type: 'intro' }, { template_type: 'custom', template_id: 'gone' }] };
    expect(pickerOptions({ ...base, sequences: [broken], enrollment: enr(2) })).toEqual({
      options: [
        { id: 't-intro', label: 'Step 1: Intro', group: 'sequence' },
        { id: missingStepId(2), label: 'Step 2: (template missing) (current)', group: 'sequence', disabled: true, current: true },
      ],
      selectedId: null, sequenceName: 'Cold outreach', currentStep: 2, totalSteps: 2,
    });
  });

  it('treats a type with no default template as missing', () => {
    const s: PickerSequence = { id: 's1', name: 'X', steps: [{ template_type: 'break_up' }] };
    const r = pickerOptions({ ...base, sequences: [s], enrollment: enr(1) });
    expect(r.options).toEqual([{ id: 'missing-step-1', label: 'Step 1: (template missing) (current)', group: 'sequence', disabled: true, current: true }]);
  });

  it('lists a template used by two steps once, naming both', () => {
    const s: PickerSequence = { id: 's1', name: 'Twice', steps: [{ template_type: 'intro' }, { template_type: 'follow_up' }, { template_type: 'intro' }] };
    const r = pickerOptions({ ...base, sequences: [s], enrollment: enr(3) });
    expect(r.options).toEqual([
      { id: 't-intro', label: 'Steps 1, 3: Intro (current)', group: 'sequence', current: true },
      { id: 't-fu', label: 'Step 2: Follow up', group: 'sequence' },
    ]);
    expect(r.selectedId).toBe('t-intro');
  });

  it('selects nothing when the step is past the end', () => {
    const r = pickerOptions({ ...base, enrollment: enr(4) });
    expect(r.selectedId).toBeNull();
    expect(r.currentStep).toBe(4);
    expect(r.options.some((o) => o.current)).toBe(false);
  });

  it('falls back to all templates for a sequence with no steps', () => {
    const r = pickerOptions({ ...base, sequences: [{ id: 's1', name: 'Empty', steps: [] }], enrollment: enr(1) });
    expect(r.sequenceName).toBeNull();
  });
});

describe('resolveLeadTemplate', () => {
  const args = { ...base, fallbackTemplateId: '' };
  it('uses the current step template for an active enrolment', () => {
    expect(resolveLeadTemplate({ ...args, enrollment: enr(3), fallbackTemplateId: 't-extra' })).toEqual({ templateId: 't-fu', source: 'step' });
  });
  it('falls back to the chosen template without an active enrolment', () => {
    expect(resolveLeadTemplate({ ...args, enrollment: null, fallbackTemplateId: 't-extra' })).toEqual({ templateId: 't-extra', source: 'fallback' });
    expect(resolveLeadTemplate({ ...args, enrollment: enr(1, 'paused'), fallbackTemplateId: 't-extra' })).toEqual({ templateId: 't-extra', source: 'fallback' });
  });
  it('is none when there is no enrolment and no chosen template', () => {
    expect(resolveLeadTemplate({ ...args, enrollment: null })).toEqual({ templateId: null, source: 'none' });
  });
  it('falls back when the current step has no findable template', () => {
    const s: PickerSequence = { id: 's1', name: 'X', steps: [{ template_type: 'custom', template_id: 'gone' }] };
    expect(resolveLeadTemplate({ ...args, sequences: [s], enrollment: enr(1), fallbackTemplateId: 't-extra' })).toEqual({ templateId: 't-extra', source: 'fallback' });
  });
});

describe('enrollmentsDiffer', () => {
  it('is false when every lead is in the same place', () => {
    expect(enrollmentsDiffer([enr(1), enr(1)])).toBe(false);
    expect(enrollmentsDiffer([null, null])).toBe(false);
    expect(enrollmentsDiffer([])).toBe(false);
    expect(enrollmentsDiffer([null, enr(1, 'paused')])).toBe(false);
  });
  it('is true when steps, sequences or enrolment presence differ', () => {
    expect(enrollmentsDiffer([enr(1), enr(2)])).toBe(true);
    expect(enrollmentsDiffer([enr(1), null])).toBe(true);
    expect(enrollmentsDiffer([enr(1), { sequence_id: 's2', current_step: 1, status: 'active' }])).toBe(true);
  });
});
