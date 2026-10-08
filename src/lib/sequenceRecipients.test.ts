import { describe, expect, it } from 'vitest';
import type { Contact } from '../../supabase/functions/_shared/contacts';
import {
  noRecipientsNoteText,
  planStepDrafts,
  recipientNaming,
  shouldAdvance,
} from '../../supabase/functions/_shared/sequenceRecipients';

let n = 0;
const person = (over: Partial<Contact> = {}): Contact => ({
  id: `p${++n}`,
  kind: 'person',
  first_name: 'Jane',
  last_name: 'Doe',
  title: null,
  label: null,
  email: `p${n}@x.com`,
  phone: null,
  is_primary: false,
  include_in_sequences: true,
  dismissed_at: null,
  ...over,
});
const general = (over: Partial<Contact> = {}): Contact =>
  person({ kind: 'general', first_name: null, last_name: null, label: 'Accounts', ...over });

const plan = (contacts: Contact[], leadEmail: string | null = 'Owner@Biz.com', capRemaining: number | null = null, optedOut = false) =>
  planStepDrafts({ contacts, leadEmail, optedOut, capRemaining });

describe('planStepDrafts: legacy single recipient', () => {
  it('a lead with no contacts is drafted to its own email exactly as typed', () => {
    expect(plan([])).toEqual({
      kind: 'legacy_single',
      recipients: [{ email: 'Owner@Biz.com', contactId: null, name: null }],
      limitedByCap: false,
      totalRecipients: 1,
    });
  });
  it('contacts without any email (registry officers) keep the legacy path, even for a malformed lead email', () => {
    const officers = [person({ email: null }), person({ email: '  ' })];
    expect(plan(officers).kind).toBe('legacy_single');
    expect(plan(officers, 'not-an-email').recipients).toEqual([{ email: 'not-an-email', contactId: null, name: null }]);
  });
  it('is not capped: a single legacy draft is never cut by the cap', () => {
    expect(plan([], 'a@b.com', 1).kind).toBe('legacy_single');
  });
  it('malformed contact emails fall back to the lead email as legacy', () => {
    const r = plan([person({ email: 'broken' })]);
    expect(r.kind).toBe('legacy_single');
    expect(r.recipients).toEqual([{ email: 'Owner@Biz.com', contactId: null, name: null }]);
  });
  it('a manual general inbox excluded from sequences is a legacy row and does not block the lead email', () => {
    const r = plan([general({ source: 'manual', include_in_sequences: false, email: 'old@biz.com' })]);
    expect(r.kind).toBe('legacy_single');
  });
});

describe('planStepDrafts: multi', () => {
  it('puts the main contact first, then the rest in input order', () => {
    const a = person({ id: 'a', email: 'a@x.com', title: 'Office assistant' });
    const b = person({ id: 'b', email: 'b@x.com', title: 'Owner' });
    const c = general({ id: 'c', email: 'c@x.com' });
    const r = plan([a, c, b]);
    expect(r.kind).toBe('multi');
    expect(r.recipients.map((x) => x.contactId)).toEqual(['b', 'a', 'c']);
    expect(r.recipients[0]).toEqual({ email: 'b@x.com', contactId: 'b', name: 'Jane Doe' });
    expect(r.limitedByCap).toBe(false);
    expect(r.totalRecipients).toBe(3);
  });
  it('a primary contact is first even when less senior', () => {
    const owner = person({ id: 'o', email: 'o@x.com', title: 'Owner' });
    const pri = person({ id: 'p', email: 'p@x.com', is_primary: true });
    expect(plan([owner, pri]).recipients.map((x) => x.contactId)).toEqual(['p', 'o']);
  });
  it('does not add the lead email when a curated contact exists', () => {
    const r = plan([person({ id: 'a', email: 'a@x.com' })], 'Owner@Biz.com');
    expect(r.recipients.map((x) => x.email)).toEqual(['a@x.com']);
  });
  it('de-duplicates the same address across contacts', () => {
    const r = plan([person({ id: 'a', email: 'dup@x.com' }), person({ id: 'b', email: 'DUP@x.com' })]);
    expect(r.recipients.map((x) => x.email)).toEqual(['dup@x.com']);
  });
  it('skips a contact excluded from sequences but writes to the others', () => {
    const r = plan([person({ id: 'a', email: 'a@x.com', include_in_sequences: false }), person({ id: 'b', email: 'b@x.com' })]);
    expect(r.recipients.map((x) => x.contactId)).toEqual(['b']);
  });
  it('truncates to the remaining daily cap and says so', () => {
    const cs = [person({ id: 'a', email: 'a@x.com', is_primary: true }), person({ id: 'b', email: 'b@x.com' }), person({ id: 'c', email: 'c@x.com' })];
    const r = plan(cs, null, 2);
    expect(r.recipients.map((x) => x.contactId)).toEqual(['a', 'b']);
    expect(r.limitedByCap).toBe(true);
    expect(r.totalRecipients).toBe(3);
  });
  it('a cap equal to the recipient count is not a limitation; null and Infinity mean no cap', () => {
    const cs = [person({ email: 'a@x.com' }), person({ email: 'b@x.com' })];
    expect(plan(cs, null, 2).limitedByCap).toBe(false);
    expect(plan(cs, null, null).recipients).toHaveLength(2);
    expect(plan(cs, null, Number.POSITIVE_INFINITY).recipients).toHaveLength(2);
  });
  it('a cap of zero leaves no recipients (the caller never advances)', () => {
    const r = plan([person({ email: 'a@x.com' })], null, 0);
    expect(r.recipients).toEqual([]);
    expect(r.limitedByCap).toBe(true);
  });
});

describe('planStepDrafts: none', () => {
  it('every curated contact excluded => no recipients, to be paused visibly', () => {
    const r = plan([person({ email: 'a@x.com', include_in_sequences: false })]);
    expect(r).toEqual({ kind: 'none', recipients: [], limitedByCap: false, totalRecipients: 0, reason: 'no_recipients' });
  });
  it('no lead email and no contact email => the old "lead has no email" skip', () => {
    expect(plan([], null).reason).toBe('no_email');
    expect(plan([person({ email: null })], '  ').reason).toBe('no_email');
  });
  it('no lead email and only excluded contacts => no recipients (pause), not the silent skip', () => {
    expect(plan([person({ email: 'a@x.com', include_in_sequences: false })], null).reason).toBe('no_recipients');
  });
  it('an opted-out lead gets nothing', () => {
    expect(plan([person({ email: 'a@x.com' })], 'a@b.com', null, true)).toEqual({
      kind: 'none', recipients: [], limitedByCap: false, totalRecipients: 0, reason: 'opted_out',
    });
  });
});

describe('shouldAdvance', () => {
  it('advances once when at least one draft was created, whatever failed', () => {
    expect(shouldAdvance({ draftsCreated: 1, failures: 0 })).toBe(true);
    expect(shouldAdvance({ draftsCreated: 2, failures: 3 })).toBe(true);
  });
  it('does not advance when nothing was drafted', () => {
    expect(shouldAdvance({ draftsCreated: 0, failures: 2 })).toBe(false);
    expect(shouldAdvance({ draftsCreated: 0, failures: 0 })).toBe(false);
  });
});

describe('noRecipientsNoteText', () => {
  it('is the exact visible note text', () => {
    expect(noRecipientsNoteText()).toBe('Sequence paused: no contact on this lead is set to receive follow-ups');
  });
});

describe('recipientNaming', () => {
  it('greets a named person by their name and keeps their title', () => {
    expect(recipientNaming(person({ first_name: ' Jane ', last_name: 'Doe', title: ' Owner ' }))).toEqual({
      ownerName: 'Jane Doe', generalInbox: false, title: 'Owner',
    });
    expect(recipientNaming(person({ first_name: 'Jane', last_name: null, title: null }))).toEqual({
      ownerName: 'Jane', generalInbox: false, title: null,
    });
  });
  it('never names anyone for a shared inbox', () => {
    expect(recipientNaming(general({ label: 'Accounts', title: 'Accounts team' }))).toEqual({
      ownerName: null, generalInbox: true, title: null,
    });
  });
  it('a person with only a surname gets the neutral greeting and is not named', () => {
    expect(recipientNaming(person({ first_name: null, last_name: 'Doe' }))).toEqual({
      ownerName: null, generalInbox: true, title: null,
    });
    expect(recipientNaming(person({ first_name: '  ', last_name: null }))).toEqual({
      ownerName: null, generalInbox: true, title: null,
    });
  });
});
