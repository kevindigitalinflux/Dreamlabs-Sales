import type { SequenceStep, TemplateType } from '../types';

/**
 * A sequence step points at its email template one of two ways:
 *  - by `template_type`: one of the built-in kinds (initial_followup, second_chase…).
 *    The engine finds that kind's default template for the org. This is how every
 *    seeded sequence works.
 *  - by `template_id`: a specific template, used for the user's own (custom) ones, which
 *    all share the generic type 'custom' and so can't be told apart by type.
 * The step dropdown encodes either as a single string value.
 */
export function stepTemplateValue(step: Pick<SequenceStep, 'template_type' | 'template_id'>): string {
  return step.template_id ? `id:${step.template_id}` : `type:${step.template_type}`;
}

/** Inverse of stepTemplateValue: the step fields a dropdown value stands for. */
export function stepFieldsFromValue(value: string): Pick<SequenceStep, 'template_type' | 'template_id'> {
  if (value.startsWith('id:')) return { template_type: 'custom', template_id: value.slice(3) };
  return { template_type: value.replace(/^type:/, '') as TemplateType, template_id: null };
}
