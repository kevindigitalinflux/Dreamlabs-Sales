import { stepUsesTemplate } from '../../supabase/functions/_shared/postSendRules';

/** A template as the picker needs it. */
export interface PickerTemplate { id: string; name: string; template_type: string; is_default: boolean }

/** A sequence as the picker needs it. */
export interface PickerSequence {
  id: string;
  name: string;
  steps: { template_type: string; template_id?: string | null }[];
}

/** A lead's enrolment as the picker needs it. `current_step` is the 1-based step due next. */
export interface PickerEnrollment { sequence_id: string; current_step: number; status: string }

/** One entry in the template list. `disabled` and `current` are only present when true. */
export interface PickerOption {
  id: string;
  label: string;
  group: 'sequence' | 'other';
  disabled?: true;
  current?: true;
}

/** What the picker shows for one lead. */
export interface PickerResult {
  options: PickerOption[];
  selectedId: string | null;
  sequenceName: string | null;
  currentStep: number | null;
  totalSteps: number | null;
}

/** Input to {@link pickerOptions}. */
export interface PickerInput {
  templates: PickerTemplate[];
  enrollment: PickerEnrollment | null;
  sequences: PickerSequence[];
  defaultTemplateIdByType: Record<string, string>;
  showAll: boolean;
}

/** Id used for a step whose template cannot be found. Never a real template id, always disabled. */
export function missingStepId(step: number): string {
  return `missing-step-${step}`;
}

/**
 * The enrolment's sequence when the lead is actively following one that still exists and has steps,
 * else null (paused, completed, cancelled, no enrolment, deleted sequence all mean "not following").
 */
function followedSequence(input: PickerInput): PickerSequence | null {
  const e = input.enrollment;
  if (!e || e.status !== 'active') return null;
  const seq = input.sequences.find((s) => s.id === e.sequence_id);
  return seq && seq.steps.length > 0 ? seq : null;
}

/** The template a sequence step sends: its own template id, or the default for its type. Null when it cannot be found. */
function templateForStep(
  step: PickerSequence['steps'][number], templates: PickerTemplate[], defaults: Record<string, string>,
): PickerTemplate | null {
  return templates.find((t) => stepUsesTemplate(step, t, defaults)) ?? null;
}

/**
 * The options for the composer's template list. A lead actively following a sequence gets that sequence's
 * templates in step order ("Step N: name", the current step marked, a template used by several steps listed once,
 * a step with no findable template shown disabled) with the current step's template pre-selected; `showAll` adds
 * every other template under "other". Any other lead (no enrolment, paused, finished, sequence gone) gets all
 * templates and nothing forced.
 */
export function pickerOptions(input: PickerInput): PickerResult {
  const seq = followedSequence(input);
  if (!seq) {
    return {
      options: input.templates.map((t) => ({ id: t.id, label: t.name, group: 'other' as const })),
      selectedId: null, sequenceName: null, currentStep: null, totalSteps: null,
    };
  }
  const current = input.enrollment!.current_step;
  const slots: { option: PickerOption; steps: number[]; templateId: string | null }[] = [];
  const byTemplate = new Map<string, number>();
  seq.steps.forEach((step, i) => {
    const n = i + 1;
    const tpl = templateForStep(step, input.templates, input.defaultTemplateIdByType);
    if (!tpl) {
      slots.push({ option: { id: missingStepId(n), label: '', group: 'sequence', disabled: true }, steps: [n], templateId: null });
      return;
    }
    const at = byTemplate.get(tpl.id);
    if (at !== undefined) { slots[at]!.steps.push(n); return; }
    byTemplate.set(tpl.id, slots.length);
    slots.push({ option: { id: tpl.id, label: '', group: 'sequence' }, steps: [n], templateId: tpl.id });
  });
  const names = new Map(input.templates.map((t) => [t.id, t.name]));
  for (const slot of slots) {
    const prefix = slot.steps.length === 1 ? `Step ${slot.steps[0]}` : `Steps ${slot.steps.join(', ')}`;
    const isCurrent = slot.steps.includes(current);
    slot.option.label = `${prefix}: ${slot.templateId ? names.get(slot.templateId) : '(template missing)'}${isCurrent ? ' (current)' : ''}`;
    if (isCurrent) slot.option.current = true;
  }
  const options = slots.map((s) => s.option);
  if (input.showAll) {
    for (const t of input.templates) if (!byTemplate.has(t.id)) options.push({ id: t.id, label: t.name, group: 'other' });
  }
  const currentTemplate = current >= 1 && current <= seq.steps.length
    ? templateForStep(seq.steps[current - 1]!, input.templates, input.defaultTemplateIdByType)
    : null;
  return { options, selectedId: currentTemplate?.id ?? null, sequenceName: seq.name, currentStep: current, totalSteps: seq.steps.length };
}

/** Where a lead's template came from in a bulk draft. */
export interface LeadTemplateChoice { templateId: string | null; source: 'step' | 'fallback' | 'none' }

/**
 * The template to draft for one lead when "use each lead's own sequence step" is on: its current step's template
 * when it is actively following a sequence; otherwise the single chosen template (when there is one); otherwise none.
 */
export function resolveLeadTemplate(input: {
  templates: PickerTemplate[]; enrollment: PickerEnrollment | null; sequences: PickerSequence[];
  defaultTemplateIdByType: Record<string, string>; fallbackTemplateId: string;
}): LeadTemplateChoice {
  const r = pickerOptions({ ...input, showAll: false });
  if (r.selectedId) return { templateId: r.selectedId, source: 'step' };
  if (input.fallbackTemplateId) return { templateId: input.fallbackTemplateId, source: 'fallback' };
  return { templateId: null, source: 'none' };
}

/**
 * True when the selected leads are not all in the same place: at least one actively follows a sequence and the
 * leads do not all share the same sequence and step (leads with no active enrolment count as one more place).
 */
export function enrollmentsDiffer(enrollments: (PickerEnrollment | null)[]): boolean {
  const keys = new Set(enrollments.map((e) => (e && e.status === 'active' ? `${e.sequence_id}:${e.current_step}` : 'none')));
  return keys.size > 1 && [...keys].some((k) => k !== 'none');
}
