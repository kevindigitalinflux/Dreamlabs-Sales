import { describe, expect, it } from 'vitest';
import { buildBulkTargets, countOtherContacts } from './bulkDraftTargets';
import type { DecisionMakerCandidate, Lead } from '../types';

const lead = (over: Partial<Lead>): Lead => ({ id: 'l1', business_name: 'Acme', email: null, additional_emails: [], ...over }) as unknown as Lead;
const dm = (over: Partial<DecisionMakerCandidate>): DecisionMakerCandidate => ({
  id: 'd1', lead_id: 'l1', first_name: 'Jane', last_name: 'Smith', title: 'Director', email: 'jane@acme.com', dismissed_at: null, ...over,
}) as unknown as DecisionMakerCandidate;

describe('buildBulkTargets', () => {
  it('writes only to the lead\'s own address when others are not included', () => {
    const t = buildBulkTargets([lead({ email: 'info@acme.com' })], [dm({})], false);
    expect(t.map((x) => x.email)).toEqual(['info@acme.com']);
  });

  it('adds one email per decision-maker, each addressed to that person with their title', () => {
    const t = buildBulkTargets(
      [lead({ email: 'info@acme.com' })],
      [dm({}), dm({ id: 'd2', first_name: 'Bob', last_name: 'Lee', title: 'Office manager', email: 'bob@acme.com' })],
      true,
    );
    expect(t.map((x) => [x.kind, x.name, x.title])).toEqual([
      ['lead', null, null], ['decision_maker', 'Jane Smith', 'Director'], ['decision_maker', 'Bob Lee', 'Office manager'],
    ]);
  });

  it('writes to a decision-maker even when the lead has no address of its own', () => {
    expect(buildBulkTargets([lead({})], [dm({})], true).map((x) => x.email)).toEqual(['jane@acme.com']);
  });

  it('includes additional addresses, and never writes to the same address twice (any case)', () => {
    const t = buildBulkTargets(
      [lead({ email: 'info@acme.com', additional_emails: ['INFO@acme.com', 'sales@acme.com'] })],
      [dm({ email: 'Sales@acme.com' }), dm({ id: 'd3', email: 'jane@acme.com' })],
      true,
    );
    expect(t.map((x) => x.email)).toEqual(['info@acme.com', 'sales@acme.com', 'jane@acme.com']);
  });

  it('keeps each lead\'s people separate and skips dismissed ones', () => {
    const t = buildBulkTargets(
      [lead({ id: 'l1', email: 'a@x.com' }), lead({ id: 'l2', business_name: 'Beta', email: null })],
      [dm({ id: 'd1', lead_id: 'l1', email: 'p@x.com' }), dm({ id: 'd2', lead_id: 'l2', email: 'q@y.com' }), dm({ id: 'd9', lead_id: 'l2', email: 'gone@y.com', dismissed_at: '2026-10-01' })],
      true,
    );
    expect(t.map((x) => [x.businessName, x.email])).toEqual([['Acme', 'a@x.com'], ['Acme', 'p@x.com'], ['Beta', 'q@y.com']]);
  });
});

describe('countOtherContacts', () => {
  it('counts what including others would add', () => {
    expect(countOtherContacts([lead({ email: 'a@x.com' })], [dm({}), dm({ id: 'd2', email: 'b@x.com' })])).toBe(2);
    expect(countOtherContacts([lead({ email: 'a@x.com' })], [])).toBe(0);
  });
});
