import { describe, expect, it } from 'vitest';
import { buildRecipients, defaultSelection, draftRecipientKey } from './composerRecipients';
import type { RecipientLead } from './composerRecipients';
import type { Contact } from '../../supabase/functions/_shared/contacts';

let n = 0;
const person = (over: Partial<Contact> = {}): Contact => ({
  id: `p${++n}`, kind: 'person', first_name: 'Andrea', last_name: 'Manning', title: 'Office Manager', label: null,
  email: `p${n}@hok.com`, phone: null, is_primary: false, include_in_sequences: true, dismissed_at: null, ...over,
});
const general = (over: Partial<Contact> = {}): Contact =>
  person({ id: `g${++n}`, kind: 'general', first_name: null, last_name: null, title: null, label: 'General reception', email: 'london@hok.com', ...over });
const lead = (over: Partial<RecipientLead> = {}): RecipientLead => ({
  email: 'info@hok.com', owner_name: 'Sarah Hok', business_name: 'HOK', additional_emails: [], ...over,
});

describe('buildRecipients', () => {
  it('with no contacts is just the lead email, labelled as before', () => {
    expect(buildRecipients(lead(), [])).toEqual([
      { key: 'lead', email: 'info@hok.com', label: 'Sarah Hok (info@hok.com)', candidateId: null, name: 'Sarah Hok', title: null, kind: 'lead' },
    ]);
  });

  it('falls back to the business name and handles a lead with no email', () => {
    expect(buildRecipients(lead({ owner_name: null }), [])[0]!.label).toBe('HOK (info@hok.com)');
    expect(buildRecipients(lead({ email: null }), [])).toEqual([]);
  });

  it('lists people and general inboxes with labels, position and kind', () => {
    const a = person({ id: 'a', email: 'andrea.manning@hok.com' });
    const g = general({ id: 'g' });
    expect(buildRecipients(lead(), [a, g]).slice(1)).toEqual([
      { key: 'a', email: 'andrea.manning@hok.com', label: 'Andrea Manning · Office Manager (andrea.manning@hok.com)', candidateId: 'a', name: 'Andrea Manning', title: 'Office Manager', kind: 'person' },
      { key: 'g', email: 'london@hok.com', label: 'General reception (london@hok.com)', candidateId: 'g', name: null, title: null, kind: 'general' },
    ]);
  });

  it('labels a general contact without a label as General inbox, with no dashes in any label', () => {
    const g = general({ id: 'g', label: null });
    const all = buildRecipients(lead({ additional_emails: ['x@hok.com'] }), [g, person({ id: 'a' })]);
    expect(all.find((r) => r.key === 'g')!.label).toBe('General inbox (london@hok.com)');
    for (const r of all) expect(r.label).not.toMatch(/[\u2013\u2014]/);
  });

  it('dedupes ignoring case and the contact wins over the lead email', () => {
    const c = person({ id: 'a', email: 'INFO@hok.com' });
    const out = buildRecipients(lead(), [c]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: 'a', candidateId: 'a', email: 'INFO@hok.com', kind: 'person' });
  });

  it('includes legacy extra emails only when not already covered', () => {
    const c = general({ id: 'g', email: 'london@hok.com' });
    const out = buildRecipients(lead({ additional_emails: ['London@hok.com', 'ops@hok.com', 'info@hok.com', 'ops@HOK.com'] }), [c]);
    expect(out.map((r) => r.key)).toEqual(['lead', 'extra:ops@hok.com', 'g']);
    expect(out.find((r) => r.key === 'g')!.candidateId).toBe('g');
  });

  it('excludes dismissed and invalid contacts', () => {
    const out = buildRecipients(lead(), [
      person({ id: 'd', dismissed_at: '2026-10-01T00:00:00Z' }),
      person({ id: 'n', email: null }),
      person({ id: 'b', email: 'not an email' }),
      person({ id: 'ok', email: 'ok@hok.com' }),
    ]);
    expect(out.map((r) => r.key)).toEqual(['lead', 'ok']);
  });

  it('works when the lead has no email but has contacts', () => {
    const out = buildRecipients(lead({ email: null }), [person({ id: 'a' })]);
    expect(out.map((r) => r.key)).toEqual(['a']);
  });
});

describe('defaultSelection', () => {
  it('ticks the lead email when there are no contacts', () => {
    const r = buildRecipients(lead(), []);
    expect(defaultSelection(r, [], 'info@hok.com')).toEqual(['lead']);
  });

  it('ticks the main contact (the primary) over the lead email', () => {
    const contacts = [person({ id: 'a', title: 'Director' }), general({ id: 'g', is_primary: true })];
    const r = buildRecipients(lead(), contacts);
    expect(defaultSelection(r, contacts, 'info@hok.com')).toEqual(['g']);
  });

  it('ticks the best-ranked person when none is primary', () => {
    const contacts = [person({ id: 'a', title: 'Assistant' }), person({ id: 'b', title: 'Managing Director', email: 'md@hok.com' })];
    const r = buildRecipients(lead(), contacts);
    expect(defaultSelection(r, contacts, 'info@hok.com')).toEqual(['b']);
  });

  it('keeps the lead email ahead of an unmarked general inbox', () => {
    const contacts = [general({ id: 'g' })];
    const r = buildRecipients(lead(), contacts);
    expect(defaultSelection(r, contacts, 'info@hok.com')).toEqual(['lead']);
  });

  it('ticks the covering contact when it holds the lead address', () => {
    const contacts = [general({ id: 'g', email: 'INFO@hok.com' })];
    const r = buildRecipients(lead(), contacts);
    expect(defaultSelection(r, contacts, 'info@hok.com')).toEqual(['g']);
  });

  it('is empty when there is nothing to write to, and falls back to lead for an odd address', () => {
    expect(defaultSelection([], [], null)).toEqual([]);
    const r = buildRecipients(lead({ email: 'weird' }), []);
    expect(defaultSelection(r, [], 'weird')).toEqual(['lead']);
  });
});

describe('draftRecipientKey', () => {
  const a = person({ id: 'a', email: 'a@hok.com' });
  const r = buildRecipients(lead({ additional_emails: ['x@hok.com'] }), [a]);

  it('uses the contact when the id and the address both match', () => {
    expect(draftRecipientKey({ to_email: 'A@hok.com', decision_maker_candidate_id: 'a' }, r)).toBe('a');
  });

  it('ignores the contact id when the contact now has a different address, falling to the address match', () => {
    expect(draftRecipientKey({ to_email: 'info@hok.com', decision_maker_candidate_id: 'a' }, r)).toBe('lead');
  });

  it('is null when the id matches but its address changed and nobody else has the draft address', () => {
    expect(draftRecipientKey({ to_email: 'old@hok.com', decision_maker_candidate_id: 'a' }, r)).toBeNull();
  });

  it('matches the lead, a legacy extra or a contact by address alone, ignoring case', () => {
    expect(draftRecipientKey({ to_email: 'INFO@hok.com', decision_maker_candidate_id: null }, r)).toBe('lead');
    expect(draftRecipientKey({ to_email: 'x@hok.com', decision_maker_candidate_id: null }, r)).toBe('extra:x@hok.com');
    expect(draftRecipientKey({ to_email: 'A@hok.com', decision_maker_candidate_id: null }, r)).toBe('a');
  });

  it('is null for a removed contact with an unknown address', () => {
    expect(draftRecipientKey({ to_email: 'gone@hok.com', decision_maker_candidate_id: 'zzz' }, r)).toBeNull();
  });
});
