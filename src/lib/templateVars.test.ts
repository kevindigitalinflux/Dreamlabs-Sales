import { describe, expect, it } from 'vitest';
import { buildTemplateVars, substituteVariables } from './templateVars';
import type { Lead } from '../types';

function makeLead(overrides: Partial<Lead>): Lead {
  return {
    id: 'x', business_name: 'Acme Ltd', owner_name: null, phone: null, email: null,
    website: null, address: null, city: null, postcode: null,
    google_rating: null, review_count: null, vertical: null,
    stage: 'new_lead', package_tier: null, deal_value: null,
    assigned_to: null, created_by: null, raw_lead_id: null,
    next_action_date: null, next_action_note: null,
    call_count: 0, last_contacted_at: null, kanban_position: 0,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('substituteVariables', () => {
  it('replaces known variables', () => {
    const r = substituteVariables('Hi {{first_name}} of {{business_name}}', { first_name: 'Ana', business_name: 'Acme' });
    expect(r.text).toBe('Hi Ana of Acme');
    expect(r.missing).toEqual([]);
  });
  it('blanks and reports variables without a value', () => {
    const r = substituteVariables('Re: {{business_name}} on {{audit_date}}', { business_name: 'Acme', audit_date: null });
    expect(r.text).toBe('Re: Acme on ');
    expect(r.missing).toEqual(['audit_date']);
  });
  it('reports unknown variables as missing and blanks them', () => {
    const r = substituteVariables('{{nonsense}}!', {});
    expect(r.text).toBe('!');
    expect(r.missing).toEqual(['nonsense']);
  });
  it('handles repeated variables once in missing', () => {
    const r = substituteVariables('{{x}} {{x}}', {});
    expect(r.missing).toEqual(['x']);
  });
});

describe('buildTemplateVars', () => {
  const lead = makeLead({
    business_name: 'Shiny Cleaners', owner_name: 'Ana Diaz',
    package_tier: 'ai_foundation', deal_value: 1200,
  });
  it('derives first_name from owner_name', () => {
    expect(buildTemplateVars(lead, 'Kevin').first_name).toBe('Ana');
  });
  it('formats package and deal value', () => {
    const v = buildTemplateVars(lead, 'Kevin');
    expect(v.package_name).toBe('AI Foundation');
    expect(v.deal_value).toBe('£1,200');
    expect(v.contractor_name).toBe('Kevin');
  });
  it('extracts pain_point from a debrief note when present', () => {
    const notes = ['Call outcome: Positive\n\nMain pain point:\nNo online booking\n\nObjections:\nCost'];
    expect(buildTemplateVars(lead, 'Kevin', notes).pain_point).toBe('No online booking');
  });
  it('leaves unresolvable vars null', () => {
    const v = buildTemplateVars(makeLead({}), 'Kevin');
    expect(v.first_name).toBeNull();
    expect(v.audit_date).toBeNull();
    expect(v.cal_link).toBeNull();
    expect(v.pain_point).toBeNull();
  });
});
