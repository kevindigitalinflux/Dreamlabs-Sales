import { describe, expect, it } from 'vitest';
import { additionsFor, additionsPatchFor, alreadyOnLead } from './decisionMakerAdditions';
import type { DecisionMakerCandidate, Lead } from '../types';

function candidate(overrides: Partial<DecisionMakerCandidate>): DecisionMakerCandidate {
  return {
    id: 'c1', lead_id: 'lead-1', source: 'hunter', apollo_person_id: null,
    first_name: 'Jane', last_name: 'Smith', name_obfuscated: false, title: 'Director',
    email: 'jane@x.com', email_revealed: true, phone: null, phone_status: 'not_requested',
    linkedin_url: null, kind: 'person', label: null, is_primary: false, include_in_sequences: true,
    dismissed_at: null, created_at: '', updated_at: '', ...overrides,
  };
}
const lead = (overrides: Partial<Lead> = {}) => ({
  email: null, phone: null, website: null, owner_name: null,
  additional_emails: [], additional_phones: [], additional_websites: [], additional_owners: [], ...overrides,
}) as unknown as Lead;

describe('additionsFor', () => {
  it('uses name+title, email and phone when known', () => {
    expect(additionsFor(candidate({ phone: '0207' }))).toEqual([
      { field: 'owner_name', value: 'Jane Smith (Director)', source: 'hunter' },
      { field: 'email', value: 'jane@x.com', source: 'hunter' },
      { field: 'phone', value: '0207', source: 'hunter' },
    ]);
  });

  it('skips an unrevealed Apollo contact\'s obfuscated name and has nothing when nothing is known', () => {
    expect(additionsFor(candidate({ source: 'apollo', name_obfuscated: true, email: null }))).toEqual([]);
  });
});

describe('alreadyOnLead / additionsPatchFor', () => {
  it('is true when values are the primary or already in additional lists (any case)', () => {
    const adds = additionsFor(candidate({}));
    expect(alreadyOnLead(lead({ owner_name: 'jane smith (director)', additional_emails: ['JANE@x.com'] }), adds)).toBe(true);
    expect(alreadyOnLead(lead({ additional_emails: ['jane@x.com'] }), adds)).toBe(false);
  });

  it('builds one patch for several candidates, only with what is new', () => {
    const l = lead({ additional_emails: ['jane@x.com'] });
    const patch = additionsPatchFor(l, [candidate({}), candidate({ id: 'c2', first_name: 'Bob', last_name: 'Lee', title: null, email: 'bob@x.com' })]);
    expect(patch).toEqual({ additional_owners: ['Jane Smith (Director)', 'Bob Lee'], additional_emails: ['jane@x.com', 'bob@x.com'] });
  });

  it('returns null when everything is already on the lead', () => {
    expect(additionsPatchFor(lead({ additional_emails: ['jane@x.com'], additional_owners: ['Jane Smith (Director)'] }), [candidate({})])).toBeNull();
  });
});
