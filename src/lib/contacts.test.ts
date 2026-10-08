import { describe, expect, it } from 'vitest';
import {
  contactDisplayName,
  isUsable,
  mainContact,
  sequenceRecipients,
  validateContactEdit,
  type Contact,
} from '../../supabase/functions/_shared/contacts';

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

describe('contactDisplayName', () => {
  it('joins first and last name for a person', () => {
    expect(contactDisplayName(person({ first_name: ' Jane ', last_name: 'Doe' }))).toBe('Jane Doe');
    expect(contactDisplayName(person({ first_name: 'Jane', last_name: null }))).toBe('Jane');
    expect(contactDisplayName(person({ first_name: null, last_name: 'Doe' }))).toBe('Doe');
  });
  it('falls back to the label, then Unknown name, for a nameless person', () => {
    expect(contactDisplayName(person({ first_name: null, last_name: '  ', label: 'Front desk' }))).toBe('Front desk');
    expect(contactDisplayName(person({ first_name: null, last_name: null, label: null }))).toBe('Unknown name');
  });
  it('uses the label for a general contact, else General inbox', () => {
    expect(contactDisplayName(general({ label: 'Accounts' }))).toBe('Accounts');
    expect(contactDisplayName(general({ label: null }))).toBe('General inbox');
    expect(contactDisplayName(general({ label: '  ' }))).toBe('General inbox');
  });
});

describe('isUsable', () => {
  it('needs a plausible email and no dismissal', () => {
    expect(isUsable(person({ email: 'a@x.com' }))).toBe(true);
    expect(isUsable(person({ email: ' A@X.com ' }))).toBe(true);
    expect(isUsable(person({ email: null }))).toBe(false);
    expect(isUsable(person({ email: 'nope' }))).toBe(false);
    expect(isUsable(person({ email: 'a@b.c' }))).toBe(false);
    expect(isUsable(person({ email: 'a@x.com', dismissed_at: '2026-10-01T00:00:00Z' }))).toBe(false);
  });
});

describe('mainContact', () => {
  it('lets a usable primary beat a more senior person', () => {
    const r = mainContact(
      [
        person({ id: 'boss', title: 'Managing Director', email: 'boss@x.com' }),
        person({ id: 'prim', title: 'Clerk', email: 'Prim@x.com', is_primary: true }),
      ],
      'lead@x.com',
    );
    expect(r).toEqual({ email: 'prim@x.com', contactId: 'prim' });
  });

  it('skips a primary that is dismissed', () => {
    const r = mainContact(
      [
        person({ id: 'prim', email: 'prim@x.com', is_primary: true, dismissed_at: '2026-10-01T00:00:00Z' }),
        person({ id: 'b', title: 'Owner', email: 'b@x.com' }),
      ],
      null,
    );
    expect(r).toEqual({ email: 'b@x.com', contactId: 'b' });
  });

  it('skips a primary with no valid email', () => {
    const r = mainContact(
      [
        person({ id: 'prim', email: 'not-an-email', is_primary: true }),
        person({ id: 'b', title: 'Clerk', email: 'b@x.com' }),
      ],
      null,
    );
    expect(r?.contactId).toBe('b');
  });

  it('ranks people by seniority tier and keeps input order within a tier', () => {
    const rank = (...titles: (string | null)[]) =>
      mainContact(titles.map((title, i) => person({ id: String(i), title, email: `q${i}@x.com` })), null)?.contactId;
    expect(rank('Clerk', 'Owner')).toBe('1');
    expect(rank('Head of Sales', 'Director')).toBe('1');
    expect(rank('Assistant Manager', 'Head of Sales')).toBe('1');
    expect(rank('Manager', 'Head of Ops')).toBe('0');
    expect(rank(null, 'Clerk')).toBe('0');
  });

  it('prefers a named person over a general inbox', () => {
    const r = mainContact(
      [general({ id: 'g', email: 'info@x.com' }), person({ id: 'p', title: 'Clerk', email: 'p@x.com' })],
      'lead@x.com',
    );
    expect(r?.contactId).toBe('p');
  });

  it('lets a general contact marked primary win over people', () => {
    const r = mainContact(
      [person({ id: 'p', title: 'Owner', email: 'p@x.com' }), general({ id: 'g', email: 'info@x.com', is_primary: true })],
      'lead@x.com',
    );
    expect(r).toEqual({ email: 'info@x.com', contactId: 'g' });
  });

  it('ranks the lead own email above migrated Additional email rows (any case)', () => {
    const r = mainContact([general({ id: 'g', label: 'additional EMAIL', email: 'extra@x.com' })], 'Lead@x.com');
    expect(r).toEqual({ email: 'lead@x.com', contactId: null });
  });

  it('ranks the lead own email above manual general rows that are excluded from sequences', () => {
    const r = mainContact(
      [general({ id: 'g', label: 'Whatever', source: 'manual', include_in_sequences: false, email: 'extra@x.com' })],
      'lead@x.com',
    );
    expect(r).toEqual({ email: 'lead@x.com', contactId: null });
  });

  it('keeps a primary legacy row above the lead own email', () => {
    const r = mainContact(
      [general({ id: 'g', label: 'Additional email', email: 'extra@x.com', is_primary: true })],
      'lead@x.com',
    );
    expect(r?.contactId).toBe('g');
  });

  it('never lets an unmarked general inbox beat the lead own email', () => {
    const r = mainContact([general({ id: 'g', label: 'Accounts', email: 'acc@x.com' })], 'lead@x.com');
    expect(r).toEqual({ email: 'lead@x.com', contactId: null });
  });

  it('lets a general inbox marked primary beat the lead own email', () => {
    const r = mainContact([general({ id: 'g', label: 'Accounts', email: 'acc@x.com', is_primary: true })], 'lead@x.com');
    expect(r).toEqual({ email: 'acc@x.com', contactId: 'g' });
  });

  it('still ranks a named person above the lead own email', () => {
    const r = mainContact([person({ id: 'p', title: 'Clerk', email: 'p@x.com' })], 'lead@x.com');
    expect(r?.contactId).toBe('p');
  });

  it('falls back to the first usable general inbox, curated before legacy, when the lead has no email', () => {
    const rows = [
      general({ id: 'legacy', label: 'Additional email', email: 'old@x.com' }),
      general({ id: 'g1', label: 'Accounts', email: 'acc@x.com' }),
      general({ id: 'g2', label: 'Sales', email: 'sales@x.com' }),
    ];
    expect(mainContact(rows, null)).toEqual({ email: 'acc@x.com', contactId: 'g1' });
  });

  it('falls back to a legacy general row only when the lead has no valid email', () => {
    const rows = [general({ id: 'g', label: 'Additional email', email: 'extra@x.com' })];
    expect(mainContact(rows, null)).toEqual({ email: 'extra@x.com', contactId: 'g' });
    expect(mainContact(rows, 'garbage')).toEqual({ email: 'extra@x.com', contactId: 'g' });
  });

  it('returns null when nothing is usable', () => {
    expect(mainContact([], null)).toBeNull();
    expect(mainContact([person({ email: null })], '')).toBeNull();
    expect(mainContact([person({ dismissed_at: 'x' })], 'bad')).toBeNull();
  });

  it('trims and lowercases emails', () => {
    expect(mainContact([person({ id: 'a', email: '  Jane@X.COM ' })], null)).toEqual({ email: 'jane@x.com', contactId: 'a' });
  });
});

describe('sequenceRecipients', () => {
  it('is empty when the lead has opted out', () => {
    expect(sequenceRecipients([person({ email: 'a@x.com' })], 'lead@x.com', true)).toEqual([]);
    expect(sequenceRecipients([], 'lead@x.com', true)).toEqual([]);
  });

  it('falls back to the lead own email when there are no contacts', () => {
    expect(sequenceRecipients([], ' Lead@X.com ', false)).toEqual([{ email: 'lead@x.com', contactId: null, name: null }]);
    expect(sequenceRecipients([], null, false)).toEqual([]);
    expect(sequenceRecipients([], 'bad', false)).toEqual([]);
  });

  it('falls back to the lead own email when no contact is usable', () => {
    const r = sequenceRecipients([person({ email: null }), person({ dismissed_at: 'x' })], 'lead@x.com', false);
    expect(r).toEqual([{ email: 'lead@x.com', contactId: null, name: null }]);
  });

  it('includes only contacts with include_in_sequences and not the lead email alongside named contacts', () => {
    const r = sequenceRecipients(
      [
        person({ id: 'a', first_name: 'Ann', last_name: 'A', email: 'a@x.com' }),
        person({ id: 'b', email: 'b@x.com', include_in_sequences: false }),
      ],
      'lead@x.com',
      false,
    );
    expect(r).toEqual([{ email: 'a@x.com', contactId: 'a', name: 'Ann A' }]);
  });

  it('sends to nobody when every usable curated contact is excluded', () => {
    expect(sequenceRecipients([person({ email: 'b@x.com', include_in_sequences: false })], 'lead@x.com', false)).toEqual([]);
  });

  it('still includes the lead email when only migrated legacy rows exist and they are excluded', () => {
    const r = sequenceRecipients(
      [general({ id: 'g', label: 'Additional email', email: 'extra@x.com', include_in_sequences: false })],
      'lead@x.com',
      false,
    );
    expect(r).toEqual([{ email: 'lead@x.com', contactId: null, name: null }]);
  });

  it('de-duplicates by lowercased email and keeps the primary', () => {
    const r = sequenceRecipients(
      [
        person({ id: 'first', title: 'Owner', email: 'Dup@x.com' }),
        person({ id: 'prim', title: 'Clerk', email: 'dup@x.com', is_primary: true }),
      ],
      null,
      false,
    );
    expect(r.map((x) => x.contactId)).toEqual(['prim']);
    expect(r[0]?.email).toBe('dup@x.com');
  });

  it('keeps the first of equal duplicates', () => {
    const r = sequenceRecipients(
      [person({ id: 'one', email: 'd@x.com' }), person({ id: 'two', email: 'D@x.com' })],
      null,
      false,
    );
    expect(r.map((x) => x.contactId)).toEqual(['one']);
  });

  it('keeps the more senior contact when duplicates have no primary', () => {
    const r = sequenceRecipients(
      [person({ id: 'clerk', title: 'Clerk', email: 'd@x.com' }), person({ id: 'owner', title: 'Owner', email: 'd@x.com' })],
      null,
      false,
    );
    expect(r.map((x) => x.contactId)).toEqual(['owner']);
  });

  it('puts the main contact first and keeps input order otherwise', () => {
    const r = sequenceRecipients(
      [
        person({ id: 'a', title: 'Clerk', email: 'a@x.com' }),
        person({ id: 'b', title: 'Clerk', email: 'b@x.com' }),
        person({ id: 'c', title: 'Clerk', email: 'c@x.com', is_primary: true }),
      ],
      null,
      false,
    );
    expect(r.map((x) => x.contactId)).toEqual(['c', 'a', 'b']);
  });

  it('sends to nobody and not the lead email when every curated contact is excluded (deliberate)', () => {
    const rows = [
      person({ id: 'a', email: 'a@x.com', include_in_sequences: false }),
      general({ id: 'g', label: 'Accounts', email: 'g@x.com', include_in_sequences: false }),
    ];
    expect(sequenceRecipients(rows, 'lead@x.com', false)).toEqual([]);
  });

  it('lets exclusion win: an excluded or dismissed address is not mailed through another contact', () => {
    const rows = [
      person({ id: 'a', email: 'dup@x.com', include_in_sequences: false }),
      person({ id: 'b', email: 'DUP@x.com' }),
      person({ id: 'c', email: 'ok@x.com' }),
      person({ id: 'd', email: 'gone@x.com', dismissed_at: '2026-10-01T00:00:00Z' }),
      person({ id: 'e', email: 'Gone@x.com' }),
    ];
    expect(sequenceRecipients(rows, null, false).map((r) => r.contactId)).toEqual(['c']);
  });

  it('does not add the lead own email when a contact with that address is excluded', () => {
    const rows = [general({ id: 'g', label: 'Additional email', email: 'lead@x.com', include_in_sequences: false })];
    expect(sequenceRecipients(rows, 'LEAD@x.com', false)).toEqual([]);
  });

  it('ignores an unusable primary and uses the usable person', () => {
    const rows = [
      person({ id: 'prim', email: 'not-an-email', is_primary: true }),
      person({ id: 'dprim', email: 'd@x.com', is_primary: true, dismissed_at: 'x' }),
      person({ id: 'p', title: 'Clerk', email: 'p@x.com' }),
    ];
    expect(sequenceRecipients(rows, 'lead@x.com', false).map((r) => r.contactId)).toEqual(['p']);
  });

  it('names a general contact by its label', () => {
    const r = sequenceRecipients([general({ id: 'g', label: 'Accounts', email: 'acc@x.com' })], null, false);
    expect(r).toEqual([{ email: 'acc@x.com', contactId: 'g', name: 'Accounts' }]);
  });
});

describe('validateContactEdit', () => {
  const ok = { kind: 'person', first_name: ' Jane ', last_name: 'Doe', email: ' Jane@X.COM ' };

  it('accepts a person and normalises it', () => {
    const r = validateContactEdit({ ...ok, title: ' Owner ', phone: ' +44 (0)20 7946-0958 ', linkedin_url: ' https://www.linkedin.com/in/jane ' });
    expect(r).toEqual({
      ok: true,
      value: {
        kind: 'person',
        first_name: 'Jane',
        last_name: 'Doe',
        title: 'Owner',
        label: null,
        email: 'jane@x.com',
        phone: '+44 (0)20 7946-0958',
        linkedin_url: 'https://www.linkedin.com/in/jane',
      },
    });
  });

  it('turns empty strings into null', () => {
    const r = validateContactEdit({ kind: 'person', first_name: 'Jane', last_name: '  ', title: '', label: '', email: '', phone: '', linkedin_url: '' });
    expect(r).toEqual({
      ok: true,
      value: { kind: 'person', first_name: 'Jane', last_name: null, title: null, label: null, email: null, phone: null, linkedin_url: null },
    });
  });

  it('accepts a general contact with only a label', () => {
    const r = validateContactEdit({ kind: 'general', label: ' Accounts ', email: 'ACC@x.com' });
    expect(r).toEqual({
      ok: true,
      value: { kind: 'general', first_name: null, last_name: null, title: null, label: 'Accounts', email: 'acc@x.com', phone: null, linkedin_url: null },
    });
  });

  const err = (input: Parameters<typeof validateContactEdit>[0]) => {
    const r = validateContactEdit(input);
    return r.ok ? null : r.error;
  };

  it('rejects an unknown or missing kind', () => {
    expect(err({ ...ok, kind: 'company' })).toBe('Choose whether this is a person or a general inbox.');
    expect(err({ first_name: 'Jane' })).toBe('Choose whether this is a person or a general inbox.');
  });

  it('requires a first or last name for a person', () => {
    expect(err({ kind: 'person', first_name: ' ', last_name: '', label: 'Front desk' })).toBe('Add a first or last name for this person.');
    expect(validateContactEdit({ kind: 'person', last_name: 'Doe' })).toEqual({
      ok: true,
      value: { kind: 'person', first_name: null, last_name: 'Doe', title: null, label: null, email: null, phone: null, linkedin_url: null },
    });
  });

  it('requires a label for a general contact', () => {
    expect(err({ kind: 'general', label: '  ', email: 'a@x.com' })).toBe('Add a label for this inbox, for example Accounts.');
    expect(err({ kind: 'general', first_name: 'Jane' })).toBe('Add a label for this inbox, for example Accounts.');
  });

  it('rejects an implausible email', () => {
    for (const bad of ['nope', 'a@b', 'a@b.c', 'a b@x.com', '<a@x.com>', 'a@@x.com']) {
      expect(err({ ...ok, email: bad })).toBe('That email address does not look right.');
    }
  });

  it('restricts phone characters', () => {
    expect(err({ ...ok, phone: '020 7946 0958 ext 5' })).toBe('Phone numbers can only contain digits, spaces and + ( ) - .');
    expect(err({ ...ok, phone: '07<script>' })).toBe('Phone numbers can only contain digits, spaces and + ( ) - .');
    const r = validateContactEdit({ ...ok, phone: '+1 (555) 010-9999.' });
    expect(r.ok && r.value.phone).toBe('+1 (555) 010-9999.');
  });

  it('requires https for a LinkedIn url and a host', () => {
    const msg = 'The LinkedIn link must start with https:// and include a website address.';
    expect(err({ ...ok, linkedin_url: 'http://www.linkedin.com/in/jane' })).toBe(msg);
    expect(err({ ...ok, linkedin_url: 'linkedin.com/in/jane' })).toBe(msg);
    expect(err({ ...ok, linkedin_url: 'javascript:alert(1)' })).toBe(msg);
    expect(err({ ...ok, linkedin_url: 'https://' })).toBe(msg);
    expect(err({ ...ok, linkedin_url: 'https:///in/jane' })).toBe(msg);
    expect(err({ ...ok, linkedin_url: 'https://www.linkedin.com/in/ja ne' })).toBe(msg);
    const r = validateContactEdit({ ...ok, linkedin_url: 'HTTPS://www.linkedin.com/in/jane' });
    expect(r.ok && r.value.linkedin_url).toBe('HTTPS://www.linkedin.com/in/jane');
  });

  it('caps lengths', () => {
    const long = (len: number) => 'a'.repeat(len);
    expect(err({ ...ok, first_name: long(81) })).toBe('First name must be 80 characters or fewer.');
    expect(err({ ...ok, last_name: long(81) })).toBe('Last name must be 80 characters or fewer.');
    expect(err({ ...ok, title: long(121) })).toBe('Position must be 120 characters or fewer.');
    expect(err({ kind: 'general', label: long(81) })).toBe('Label must be 80 characters or fewer.');
    expect(err({ ...ok, email: `${long(250)}@x.com` })).toBe('Email must be 254 characters or fewer.');
    expect(err({ ...ok, phone: '1'.repeat(41) })).toBe('Phone must be 40 characters or fewer.');
    const r = validateContactEdit({ ...ok, first_name: long(80), title: long(120) });
    expect(r.ok && [r.value.first_name, r.value.title]).toEqual([long(80), long(120)]);
  });

  it('rejects control characters and line separators in every text field', () => {
    const bad = ['\n', '\r', '\t', '\u0000', '\u001F', '\u007F', '\u2028', '\u2029'];
    const fields = ['first_name', 'last_name', 'title', 'label', 'email', 'phone', 'linkedin_url'] as const;
    for (const ch of bad) {
      for (const f of fields) {
        const input = { ...ok, kind: 'person', label: 'L', phone: '12345', linkedin_url: 'https://a.com/x', [f]: `ab${ch}cd` };
        const r = validateContactEdit(input);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/control characters/);
      }
    }
  });

  it('trims leading and trailing newlines and tabs but not inner ones', () => {
    const r = validateContactEdit({ ...ok, first_name: '\n Jane \t' });
    expect(r.ok && r.value.first_name).toBe('Jane');
  });

  it('needs at least 5 digits in a phone number', () => {
    expect(err({ ...ok, phone: '+ ( ) 123 4' })).toBe('Phone numbers need at least 5 digits.');
    expect(err({ ...ok, phone: '...' })).toBe('Phone numbers need at least 5 digits.');
    const r = validateContactEdit({ ...ok, phone: '+1 2345' });
    expect(r.ok && r.value.phone).toBe('+1 2345');
  });

  it('accepts plus addressing, uppercase email and rejects a trailing dot', () => {
    const r = validateContactEdit({ ...ok, email: 'Jane+Sales@Mail.X.CO.UK' });
    expect(r.ok && r.value.email).toBe('jane+sales@mail.x.co.uk');
    expect(err({ ...ok, email: 'jane@x.com.' })).toBe('That email address does not look right.');
  });

  it('handles unicode names and counts 80 vs 81 characters', () => {
    const accented = validateContactEdit({ kind: 'person', first_name: 'José', last_name: 'Zoë' });
    expect(accented.ok && [accented.value.first_name, accented.value.last_name]).toEqual(['José', 'Zoë']);
    const ok80 = validateContactEdit({ kind: 'person', first_name: 'é'.repeat(80) });
    expect(ok80.ok && ok80.value.first_name).toBe('é'.repeat(80));
    expect(err({ kind: 'person', first_name: 'é'.repeat(81) })).toBe('First name must be 80 characters or fewer.');
  });

  it('treats whitespace-only names as missing', () => {
    expect(err({ kind: 'person', first_name: '   ', last_name: '\u00a0 ' })).toBe('Add a first or last name for this person.');
  });

  it('keeps the label of a person who has a name', () => {
    const r = validateContactEdit({ kind: 'person', first_name: 'Jane', label: ' Front desk ' });
    expect(r.ok && [r.value.first_name, r.value.label]).toEqual(['Jane', 'Front desk']);
  });
});
