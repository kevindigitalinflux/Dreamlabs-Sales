import { describe, expect, it } from 'vitest';
import { groupChangesByLead } from './enrichmentGrouping';
import type { EnrichableField, EnrichmentResult } from '../types';

function makeResult(overrides: Partial<EnrichmentResult>): EnrichmentResult {
  return {
    lead_id: 'lead-1',
    proposed: { email: 'new@example.com' },
    source: { email: 'website' },
    ...overrides,
  };
}

describe('groupChangesByLead', () => {
  it('includes only checked fields for a lead', () => {
    const results = [makeResult({ lead_id: 'lead-1', proposed: { email: 'a@x.com', phone: '+44 20 1111 1111' } })];
    const checked = { 'lead-1': new Set<EnrichableField>(['email']) };
    expect(groupChangesByLead(results, checked)).toEqual({ 'lead-1': { email: 'a@x.com' } });
  });

  it('omits a lead entirely when nothing is checked', () => {
    const results = [makeResult({ lead_id: 'lead-1' })];
    expect(groupChangesByLead(results, {})).toEqual({});
  });

  it('groups multiple leads independently', () => {
    const results = [
      makeResult({ lead_id: 'lead-1', proposed: { email: 'a@x.com' } }),
      makeResult({ lead_id: 'lead-2', proposed: { owner_name: 'Jane Smith' } }),
    ];
    const checked = {
      'lead-1': new Set<EnrichableField>(['email']),
      'lead-2': new Set<EnrichableField>(['owner_name']),
    };
    expect(groupChangesByLead(results, checked)).toEqual({
      'lead-1': { email: 'a@x.com' },
      'lead-2': { owner_name: 'Jane Smith' },
    });
  });

  it('skips a checked field the result did not actually propose', () => {
    const results = [makeResult({ lead_id: 'lead-1', proposed: { email: 'a@x.com' } })];
    const checked = { 'lead-1': new Set<EnrichableField>(['email', 'phone']) };
    expect(groupChangesByLead(results, checked)).toEqual({ 'lead-1': { email: 'a@x.com' } });
  });
});
