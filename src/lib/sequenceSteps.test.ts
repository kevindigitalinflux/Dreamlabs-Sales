import { describe, expect, it } from 'vitest';
import { stepFieldsFromValue, stepTemplateValue } from './sequenceSteps';

describe('sequence step template value', () => {
  it('encodes a built-in kind by type and a custom template by id', () => {
    expect(stepTemplateValue({ template_type: 'initial_followup' })).toBe('type:initial_followup');
    expect(stepTemplateValue({ template_type: 'initial_followup', template_id: null })).toBe('type:initial_followup');
    expect(stepTemplateValue({ template_type: 'custom', template_id: 'abc-123' })).toBe('id:abc-123');
  });

  it('decodes both forms back into step fields', () => {
    expect(stepFieldsFromValue('type:second_chase')).toEqual({ template_type: 'second_chase', template_id: null });
    expect(stepFieldsFromValue('id:abc-123')).toEqual({ template_type: 'custom', template_id: 'abc-123' });
  });
});
