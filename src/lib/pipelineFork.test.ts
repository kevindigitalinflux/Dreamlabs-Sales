import { describe, expect, it } from 'vitest';
import { buildForkedLeadRows } from './pipelineFork';
import type { Lead } from '../types';

function makeLead(overrides: Partial<Lead>): Lead {
  return {
    id: crypto.randomUUID(),
    business_name: 'Acme Ltd', owner_name: null, phone: null, email: null,
    website: null, address: null, city: null, postcode: null,
    google_rating: null, review_count: null, vertical: null,
    stage: 'new_lead', package_tier: null, deal_value: null,
    assigned_to: null, created_by: null, raw_lead_id: null,
    next_action_date: null, next_action_note: null, is_priority: false,
    call_count: 0, last_contacted_at: null, kanban_position: 0,
    pipeline_id: 'source-pipeline', forked_from_lead_id: null,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildForkedLeadRows', () => {
  it('copies working fields into the new pipeline/org, owned by the forker', () => {
    const source = makeLead({
      business_name: 'Shiny Cleaners', stage: 'contacted', deal_value: 500,
      assigned_to: 'u1', call_count: 3, last_contacted_at: '2026-07-05T00:00:00Z', raw_lead_id: 'raw-1',
    });
    const [row] = buildForkedLeadRows([source], 'new-pipe', 'new-org', 'forker-id');
    expect(row.business_name).toBe('Shiny Cleaners');
    expect(row.stage).toBe('contacted');
    expect(row.deal_value).toBe(500);
    expect(row.org_id).toBe('new-org');
    expect(row.pipeline_id).toBe('new-pipe');
    expect(row.created_by).toBe('forker-id');
    expect(row.forked_from_lead_id).toBe(source.id);
  });

  it('does not carry over assigned_to, call history, or the source raw_lead_id link', () => {
    const source = makeLead({
      assigned_to: 'u1', call_count: 3, last_contacted_at: '2026-07-05T00:00:00Z', raw_lead_id: 'raw-1',
    });
    const [row] = buildForkedLeadRows([source], 'new-pipe', 'new-org', 'forker-id');
    expect(row).not.toHaveProperty('assigned_to');
    expect(row).not.toHaveProperty('call_count');
    expect(row).not.toHaveProperty('last_contacted_at');
    expect(row).not.toHaveProperty('raw_lead_id');
  });

  it('returns an empty array for an empty source pipeline', () => {
    expect(buildForkedLeadRows([], 'new-pipe', 'new-org', 'forker-id')).toEqual([]);
  });
});
