import { describe, expect, it } from 'vitest';
import { groupChangesByLead, splitEnrichmentChanges } from './enrichmentGrouping';
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

describe('splitEnrichmentChanges', () => {
  const results = [makeResult({
    lead_id: 'lead-1',
    proposed: { email: 'new@x.com', phone: '+44 20 1111 1111', owner_name: 'Jane Smith' },
    source: { email: 'hunter', phone: 'google_places', owner_name: 'companies_house' },
  })];
  const all = { 'lead-1': new Set<EnrichableField>(['email', 'phone', 'owner_name']) };

  it('fills blank fields and keeps existing ones as additions by default', () => {
    const existing = { 'lead-1': { email: 'owner@x.com', phone: null, owner_name: '' } };
    expect(splitEnrichmentChanges(results, all, existing, false)).toEqual({
      patches: { 'lead-1': { phone: '+44 20 1111 1111', owner_name: 'Jane Smith' } },
      additions: { 'lead-1': [{ field: 'email', value: 'new@x.com', source: 'hunter' }] },
    });
  });

  it('overwrites existing values when replaceExisting is on', () => {
    const existing = { 'lead-1': { email: 'owner@x.com', phone: '0207', owner_name: 'Isabella' } };
    const { patches, additions } = splitEnrichmentChanges(results, all, existing, true);
    expect(patches).toEqual({ 'lead-1': { email: 'new@x.com', phone: '+44 20 1111 1111', owner_name: 'Jane Smith' } });
    expect(additions).toEqual({});
  });

  it('drops a found value identical to the existing one and ignores unchecked fields', () => {
    const existing = { 'lead-1': { email: 'NEW@x.com', phone: null, owner_name: null } };
    const checked = { 'lead-1': new Set<EnrichableField>(['email', 'phone']) };
    expect(splitEnrichmentChanges(results, checked, existing, false)).toEqual({
      patches: { 'lead-1': { phone: '+44 20 1111 1111' } },
      additions: {},
    });
  });
});
