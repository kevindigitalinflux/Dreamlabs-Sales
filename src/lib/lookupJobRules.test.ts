import { describe, expect, it } from 'vitest';
import { parseLookupRequest, lookupReview, lookupSkipReason, canStartLookupLead, lookupErrorKind, LOOKUP_LIMITS } from '../../supabase/functions/_shared/lookupJobRules';

const id = '12345678-1234-1234-1234-123456789abc';
describe('lookup request', () => {
  it('accepts both kinds and deduplicates leads', () => {
    for (const kind of ['enrich', 'decision_makers']) expect(parseLookupRequest({ kind, lead_ids: [id, id] })).toEqual({ kind, leadIds: [id] });
  });
  it.each([null, [], {}, { kind: 'other', lead_ids: [id] }, { kind: 'enrich', lead_ids: [] }, { kind: 'enrich', lead_ids: ['oops'] }, { kind: 'enrich', lead_ids: Array(51).fill(id) }])('rejects invalid requests: %j', (body) => {
    expect(parseLookupRequest(body)).toBeNull();
  });
});
describe('lookup outcomes', () => {
  it('classifies errors without retaining provider text', () => {
    expect(lookupErrorKind(new TypeError('private provider message'))).toBe('TypeError');
    expect(lookupErrorKind({ code: 'PGRST301', message: 'private message', details: 'private details' })).toBe('PGRST301');
    expect(lookupErrorKind(Object.assign(new Error('private message'), { code: '42501' }))).toBe('42501');
    expect(lookupErrorKind({ message: 'private message' })).toBe('unknown');
    expect(lookupErrorKind('private message')).toBe('unknown');
  });
  it('only enrichment proposals need review', () => {
    expect(lookupReview('enrich', { email: 'x@example.com' })).toBe('pending');
    expect(lookupReview('enrich', {})).toBe('none');
    expect(lookupReview('decision_makers', { email: 'x@example.com' })).toBe('none');
  });
  it('fails closed for missing membership or edit rights and handles deleted leads', () => {
    expect(lookupSkipReason(false, false, false)).toBe('This lead is no longer available.');
    expect(lookupSkipReason(true, false, true)).toBe('The person who started this job is no longer in the organisation.');
    expect(lookupSkipReason(true, true, false)).toBe('The person who started this job can no longer edit this lead.');
    expect(lookupSkipReason(true, true, true)).toBeNull();
  });
  it('bounds work and daily usage', () => {
    expect(LOOKUP_LIMITS.maxLeads).toBe(50);
    expect(LOOKUP_LIMITS.orgPerDay).toBe(300);
    expect(LOOKUP_LIMITS.leadPerDay).toBe(5);
    expect(LOOKUP_LIMITS.leadBudgetMs).toBeLessThan(LOOKUP_LIMITS.wallBudgetMs);
  });
  it('reserves a whole lead and final save within the request wall budget', () => {
    expect(LOOKUP_LIMITS.wallBudgetMs).toBe(130_000);
    expect(LOOKUP_LIMITS.leadBudgetMs).toBe(100_000);
    expect(LOOKUP_LIMITS.checkpointMarginMs).toBe(10_000);
    expect(LOOKUP_LIMITS.leadReserveMs).toBe(110_000);
    expect(canStartLookupLead(0, 19_999)).toBe(true);
    expect(canStartLookupLead(0, 20_000)).toBe(false);
    expect(canStartLookupLead(0, 130_000)).toBe(false);
  });
});
