import { describe, expect, it } from 'vitest';
import type { Contact } from '../../supabase/functions/_shared/contacts';
import {
  capDecision,
  capLimitedNoteText,
  isSequenceSystemNote,
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
  it('name-only contacts (registry officers) keep the legacy path with a valid lead email', () => {
    const officers = [person({ email: null }), person({ email: '  ' })];
    expect(plan(officers).kind).toBe('legacy_single');
    expect(plan(officers).recipients).toEqual([{ email: 'Owner@Biz.com', contactId: null, name: null }]);
  });
  it('with no contact rows at all even a malformed lead email is drafted as before', () => {
    expect(plan([], 'not-an-email').recipients).toEqual([{ email: 'not-an-email', contactId: null, name: null }]);
  });
  it('with contact rows, an invalid lead email and no usable contact address is the "no email" skip', () => {
    expect(plan([person({ email: null })], 'not-an-email').reason).toBe('no_email');
    expect(plan([person({ email: 'broken' })], 'not-an-email').reason).toBe('no_email');
  });
  it('with a usable but excluded contact and an invalid lead email it is no recipients (pause)', () => {
    expect(plan([person({ email: 'a@x.com', include_in_sequences: false })], 'not-an-email').reason).toBe('no_recipients');
  });
  it('an unadopted provider-found person (switched off) neither blocks nor replaces the lead email', () => {
    const hunter = person({ id: 'h', email: 'h@x.com', source: 'hunter', include_in_sequences: false });
    expect(plan([hunter])).toEqual({
      kind: 'legacy_single', recipients: [{ email: 'Owner@Biz.com', contactId: null, name: null }], limitedByCap: false, totalRecipients: 1,
    });
    // even when it shares the lead's own address
    expect(plan([person({ email: 'owner@biz.com', source: 'hunter', include_in_sequences: false })]).kind).toBe('legacy_single');
  });
  it('a provider-found person the user switched on is curated: written to, and the lead email is not added', () => {
    const r = plan([person({ id: 'h', email: 'h@x.com', source: 'hunter', include_in_sequences: true })]);
    expect(r.recipients.map((x) => x.contactId)).toEqual(['h']);
  });
  it('a manual contact excluded by the user is still a deliberate choice (no recipients)', () => {
    expect(plan([person({ email: 'a@x.com', source: 'manual', include_in_sequences: false })]).reason).toBe('no_recipients');
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
  it('keeps the lead own email (contactId null) after an included legacy general row', () => {
    const legacy = general({ id: 'g', email: 'extra@x.com', label: 'Additional email', source: 'manual' });
    const r = plan([legacy]);
    expect(r.kind).toBe('multi');
    expect(r.recipients).toEqual([
      { email: 'extra@x.com', contactId: 'g', name: 'Additional email' },
      { email: 'owner@biz.com', contactId: null, name: null },
    ]);
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
  it('advances only when every planned recipient has a draft (created now or found already)', () => {
    expect(shouldAdvance({ planned: 1, covered: 1 })).toBe(true);
    expect(shouldAdvance({ planned: 3, covered: 3 })).toBe(true);
  });
  it('never advances on a partial result or when nothing is planned', () => {
    expect(shouldAdvance({ planned: 3, covered: 2 })).toBe(false);
    expect(shouldAdvance({ planned: 2, covered: 0 })).toBe(false);
    expect(shouldAdvance({ planned: 0, covered: 0 })).toBe(false);
  });
});

describe('capDecision', () => {
  it('everything fits, or there is no cap', () => {
    expect(capDecision({ needed: 3, capRemaining: null, dailyCap: null })).toEqual({ action: 'all', allow: 3 });
    expect(capDecision({ needed: 3, capRemaining: 3, dailyCap: 10 })).toEqual({ action: 'all', allow: 3 });
    expect(capDecision({ needed: 3, capRemaining: Number.POSITIVE_INFINITY, dailyCap: 10 })).toEqual({ action: 'all', allow: 3 });
  });
  it('defers the whole step to tomorrow when a full day could cover it', () => {
    expect(capDecision({ needed: 3, capRemaining: 2, dailyCap: 3 })).toEqual({ action: 'defer', allow: 0 });
    expect(capDecision({ needed: 3, capRemaining: 0, dailyCap: 50 })).toEqual({ action: 'defer', allow: 0 });
  });
  it('truncates only when even a full day is too small', () => {
    expect(capDecision({ needed: 5, capRemaining: 2, dailyCap: 2 })).toEqual({ action: 'truncate', allow: 2 });
    expect(capDecision({ needed: 5, capRemaining: 1, dailyCap: 4 })).toEqual({ action: 'truncate', allow: 1 });
  });
});

describe('system notes', () => {
  it('recognises the notes this feature writes, and nothing else', () => {
    expect(isSequenceSystemNote(noRecipientsNoteText())).toBe(true);
    expect(isSequenceSystemNote(capLimitedNoteText(2, 1, 4))).toBe(true);
    expect(isSequenceSystemNote('Sequence paused: because I said so')).toBe(false);
    expect(isSequenceSystemNote('Called, wants a quote')).toBe(false);
  });
  it('names how many contacts were drafted', () => {
    expect(capLimitedNoteText(2, 1, 4)).toBe('Sequence follow-up limited: step 2 was drafted for 1 of 4 contacts because the daily send cap is too small to cover them all');
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
