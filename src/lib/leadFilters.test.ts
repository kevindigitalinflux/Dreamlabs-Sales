import { describe, expect, it } from 'vitest';
import { filterLeads, sortLeads } from './leadFilters';
import type { Lead } from '../types';

const TODAY = new Date(2026, 6, 12);

function makeLead(overrides: Partial<Lead>): Lead {
  return {
    id: crypto.randomUUID(),
    business_name: 'Acme Ltd', owner_name: null, phone: null, email: null,
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

const NONE = { search: '', stages: [], assignees: [], overdueOnly: false };

describe('filterLeads', () => {
  const leads = [
    makeLead({ business_name: 'Shiny Cleaners', email: 'info@shiny.co.uk', stage: 'contacted', assigned_to: 'u1', next_action_date: '2026-07-10' }),
    makeLead({ business_name: 'Bright Sparks', owner_name: 'Ana Diaz', stage: 'won', assigned_to: 'u2' }),
    makeLead({ business_name: 'Dull & Sons', stage: 'contacted', next_action_date: '2026-07-14' }),
  ];

  it('no filters returns everything', () => {
    expect(filterLeads(leads, NONE, TODAY)).toHaveLength(3);
  });
  it('search matches name, owner and email, case-insensitively', () => {
    expect(filterLeads(leads, { ...NONE, search: 'SHINY' }, TODAY)).toHaveLength(1);
    expect(filterLeads(leads, { ...NONE, search: 'diaz' }, TODAY)).toHaveLength(1);
    expect(filterLeads(leads, { ...NONE, search: 'shiny.co' }, TODAY)).toHaveLength(1);
  });
  it('stage filter is OR within the list', () => {
    expect(filterLeads(leads, { ...NONE, stages: ['contacted'] }, TODAY)).toHaveLength(2);
    expect(filterLeads(leads, { ...NONE, stages: ['contacted', 'won'] }, TODAY)).toHaveLength(3);
  });
  it('assignee filter', () => {
    expect(filterLeads(leads, { ...NONE, assignees: ['u1'] }, TODAY)).toHaveLength(1);
  });
  it('overdueOnly keeps only past-due leads', () => {
    const result = filterLeads(leads, { ...NONE, overdueOnly: true }, TODAY);
    expect(result).toHaveLength(1);
    expect(result[0]!.business_name).toBe('Shiny Cleaners');
  });
});

describe('sortLeads', () => {
  const leads = [
    makeLead({ business_name: 'Beta', deal_value: null, stage: 'won' }),
    makeLead({ business_name: 'Alpha', deal_value: 500, stage: 'contacted' }),
    makeLead({ business_name: 'Gamma', deal_value: 100, stage: 'new_lead' }),
  ];

  it('sorts strings asc/desc', () => {
    expect(sortLeads(leads, 'business_name', 'asc').map((l) => l.business_name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(sortLeads(leads, 'business_name', 'desc').map((l) => l.business_name)).toEqual(['Gamma', 'Beta', 'Alpha']);
  });
  it('numbers sort with nulls last regardless of direction', () => {
    expect(sortLeads(leads, 'deal_value', 'asc').map((l) => l.deal_value)).toEqual([100, 500, null]);
    expect(sortLeads(leads, 'deal_value', 'desc').map((l) => l.deal_value)).toEqual([500, 100, null]);
  });
  it('stage sorts in pipeline order, not alphabetical', () => {
    expect(sortLeads(leads, 'stage', 'asc').map((l) => l.stage)).toEqual(['new_lead', 'contacted', 'won']);
  });
  it('does not mutate the input array', () => {
    const copy = [...leads];
    sortLeads(leads, 'business_name', 'asc');
    expect(leads).toEqual(copy);
  });
});
