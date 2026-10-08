import { describe, expect, it } from 'vitest';
import {
  pickRecipient,
  pickSequence,
} from '../../supabase/functions/_shared/autopilotChoices';

const sequences = [
  { id: 's1', icp_id: 'icpA' },
  { id: 's2', icp_id: 'icpB' },
  { id: 's3', icp_id: 'icpB' },
  { id: 's4', icp_id: null },
];

const base = { enrolledSequenceId: null, aiPickedId: null, icpId: null, sequences };

describe('pickSequence', () => {
  it('returns the enrolled sequence over everything else', () => {
    expect(pickSequence({ ...base, enrolledSequenceId: 's3', aiPickedId: 's1', icpId: 'icpA' })).toBe('s3');
  });

  it('keeps an enrolled sequence even when it is not in the list', () => {
    expect(pickSequence({ ...base, enrolledSequenceId: 'gone', aiPickedId: 's1' })).toBe('gone');
  });

  it('uses the AI pick when it is a real sequence id', () => {
    expect(pickSequence({ ...base, aiPickedId: 's2', icpId: 'icpA' })).toBe('s2');
  });

  it('ignores an AI pick that is not in the list and falls through to the icp match', () => {
    expect(pickSequence({ ...base, aiPickedId: 'invented', icpId: 'icpA' })).toBe('s1');
  });

  it('picks the first sequence matching the lead icp', () => {
    expect(pickSequence({ ...base, icpId: 'icpB' })).toBe('s2');
  });

  it('returns null when nothing matches', () => {
    expect(pickSequence({ ...base, icpId: 'icpZ' })).toBeNull();
    expect(pickSequence({ ...base, aiPickedId: 'invented' })).toBeNull();
  });

  it('never matches a null-icp sequence to a null lead icp', () => {
    expect(pickSequence({ ...base, icpId: null })).toBeNull();
  });

  it('treats an empty icpId as null', () => {
    expect(pickSequence({ ...base, icpId: '' })).toBeNull();
    expect(
      pickSequence({ ...base, icpId: '', sequences: [{ id: 'e', icp_id: '' }] }),
    ).toBeNull();
  });

  it('treats empty-string ids as null', () => {
    expect(pickSequence({ ...base, enrolledSequenceId: '', aiPickedId: 's2' })).toBe('s2');
    expect(pickSequence({ ...base, aiPickedId: '', icpId: 'icpA' })).toBe('s1');
  });

  it('handles an empty sequence list', () => {
    expect(pickSequence({ ...base, sequences: [], aiPickedId: 's1', icpId: 'icpA' })).toBeNull();
    expect(pickSequence({ ...base, sequences: [], enrolledSequenceId: 's1' })).toBe('s1');
  });
});

describe('pickRecipient', () => {
  it('prefers the most senior candidate with an email', () => {
    const r = pickRecipient('lead@x.com', [
      { id: 'a', title: 'Office Assistant', email: 'a@x.com' },
      { id: 'b', title: 'Managing Director', email: 'b@x.com' },
    ]);
    expect(r).toEqual({ email: 'b@x.com', candidateId: 'b' });
  });

  it('matches seniority case-insensitively, including founder, ceo and chief executive', () => {
    for (const title of ['FOUNDER', 'ceo', 'Chief Executive Officer', 'Owner', 'Head of Ops', 'Site manager']) {
      const r = pickRecipient(null, [
        { id: 'plain', title: 'Clerk', email: 'c@x.com' },
        { id: 'senior', title, email: 's@x.com' },
      ]);
      expect(r?.candidateId).toBe('senior');
    }
  });

  it('keeps input order among equally ranked candidates', () => {
    const r = pickRecipient(null, [
      { id: 'a', title: 'Clerk', email: 'a@x.com' },
      { id: 'b', title: 'Director', email: 'b@x.com' },
      { id: 'c', title: 'Owner', email: 'c@x.com' },
    ]);
    expect(r?.candidateId).toBe('c');
    const none = pickRecipient(null, [
      { id: 'a', title: null, email: 'a@x.com' },
      { id: 'b', title: 'Clerk', email: 'b@x.com' },
    ]);
    expect(none?.candidateId).toBe('a');
  });

  it('skips candidates without a usable email', () => {
    const r = pickRecipient(null, [
      { id: 'a', title: 'Owner', email: null },
      { id: 'b', title: 'Owner', email: '' },
      { id: 'c', title: 'Owner', email: '   ' },
      { id: 'd', title: 'Clerk', email: 'd@x.com' },
    ]);
    expect(r).toEqual({ email: 'd@x.com', candidateId: 'd' });
  });

  it('rejects implausible emails', () => {
    for (const bad of ['a@b.c', 'a,b@c.com', '<a@b.com>', 'mailto:a@b.com', 'a@b.com;', 'a@b.c0m', 'nope', 'a@b', 'a b@c.com', '@c.com', 'a@', 'a@.com', 'a@c.', 'a@@c.com', 'a@c..com']) {
      expect(pickRecipient(null, [{ id: 'a', title: 'Owner', email: bad }])).toBeNull();
    }
  });

  it('ignores dismissed candidates', () => {
    const r = pickRecipient('lead@x.com', [
      { id: 'a', title: 'Owner', email: 'a@x.com', dismissed_at: '2026-10-01T00:00:00Z' },
      { id: 'b', title: 'Clerk', email: 'b@x.com', dismissed_at: null },
    ]);
    expect(r?.candidateId).toBe('b');
    expect(
      pickRecipient('lead@x.com', [{ id: 'a', title: 'Owner', email: 'a@x.com', dismissed_at: 'x' }]),
    ).toEqual({ email: 'lead@x.com', candidateId: null });
  });

  it('falls back to the lead email when no candidate has one', () => {
    expect(pickRecipient('lead@x.com', [{ id: 'a', title: 'Owner', email: null }])).toEqual({
      email: 'lead@x.com',
      candidateId: null,
    });
    expect(pickRecipient('lead@x.com', [])).toEqual({ email: 'lead@x.com', candidateId: null });
  });

  it('returns null when nothing is valid', () => {
    expect(pickRecipient(null, [])).toBeNull();
    expect(pickRecipient('', [{ id: 'a', title: null, email: null }])).toBeNull();
    expect(pickRecipient('not-an-email', [])).toBeNull();
  });

  it('trims and lowercases returned emails', () => {
    expect(pickRecipient(null, [{ id: 'a', title: 'Owner', email: '  Jane@X.COM ' }])).toEqual({
      email: 'jane@x.com',
      candidateId: 'a',
    });
    expect(pickRecipient('  Lead@X.com ', [])).toEqual({ email: 'lead@x.com', candidateId: null });
  });

  it('accepts plus-addressing, subdomains and uppercase', () => {
    for (const ok of ['a+tag@b.com', 'a@mail.b.co.uk', 'A@B.COM']) {
      expect(pickRecipient(null, [{ id: 'a', title: null, email: ok }])?.email).toBe(ok.toLowerCase());
    }
  });

  const rank = (...titles: (string | null)[]) =>
    pickRecipient(
      null,
      titles.map((title, i) => ({ id: String(i), title, email: `p${i}@x.com` })),
    )?.candidateId;

  it('ranks an owner above an earlier-listed manager', () => {
    expect(rank('Manager', 'Owner')).toBe('1');
  });

  it('ranks a managing director above a director', () => {
    expect(rank('Director', 'Managing Director')).toBe('1');
  });

  it('ranks a director above a head or manager', () => {
    expect(rank('Head of Sales', 'Director')).toBe('1');
  });

  it('does not match head or manager inside other words', () => {
    expect(rank('Headteacher', 'Overhead Crane Operator', 'Manager')).toBe('2');
    expect(rank('Overhead Crane Operator', 'Headteacher')).toBe('0');
  });

  it('demotes assistant and account managers below real head/manager titles', () => {
    expect(rank('Assistant Manager', 'Head of Sales')).toBe('1');
    expect(rank('Account Manager', 'Manager')).toBe('1');
  });

  it('ranks a non-executive director below a director', () => {
    expect(rank('Non-Executive Director', 'Director')).toBe('1');
  });

  it('keeps input order within a tier', () => {
    expect(rank('Manager', 'Head of Ops')).toBe('0');
  });

  it('keeps candidateId when a candidate email equals the lead email', () => {
    expect(
      pickRecipient('a@x.com', [{ id: 'c1', title: 'Owner', email: 'A@x.com' }]),
    ).toEqual({ email: 'a@x.com', candidateId: 'c1' });
  });

  it('lets the first of duplicate candidates win', () => {
    const r = pickRecipient(null, [
      { id: 'first', title: 'Owner', email: 'd@x.com' },
      { id: 'second', title: 'Owner', email: 'd@x.com' },
    ]);
    expect(r?.candidateId).toBe('first');
  });

  it('treats an omitted dismissed_at as not dismissed', () => {
    expect(pickRecipient(null, [{ id: 'a', title: null, email: 'a@x.com' }])?.candidateId).toBe('a');
  });
});

describe('pickRecipient with primary and general contacts', () => {
  it('lets a usable primary beat a more senior person', () => {
    const r = pickRecipient('lead@x.com', [
      { id: 'boss', title: 'Managing Director', email: 'boss@x.com' },
      { id: 'prim', title: 'Clerk', email: 'Prim@x.com', is_primary: true },
    ]);
    expect(r).toEqual({ email: 'prim@x.com', candidateId: 'prim' });
  });

  it('skips a primary that is dismissed or has no valid email', () => {
    const r = pickRecipient(null, [
      { id: 'd', title: 'Clerk', email: 'd@x.com', is_primary: true, dismissed_at: '2026-10-01T00:00:00Z' },
      { id: 'n', title: 'Clerk', email: 'nope', is_primary: true },
      { id: 'b', title: 'Owner', email: 'b@x.com' },
    ]);
    expect(r).toEqual({ email: 'b@x.com', candidateId: 'b' });
  });

  it('ranks named people above a general contact, even with a more senior looking title', () => {
    const r = pickRecipient('lead@x.com', [
      { id: 'g', kind: 'general', title: 'Director', email: 'info@x.com' },
      { id: 'p', kind: 'person', title: 'Clerk', email: 'p@x.com' },
    ]);
    expect(r?.candidateId).toBe('p');
  });

  it('lets a general contact marked primary win over people', () => {
    const r = pickRecipient('lead@x.com', [
      { id: 'p', kind: 'person', title: 'Owner', email: 'p@x.com' },
      { id: 'g', kind: 'general', title: null, email: 'info@x.com', is_primary: true },
    ]);
    expect(r).toEqual({ email: 'info@x.com', candidateId: 'g' });
  });

  it('never lets an unmarked general inbox beat the lead own email', () => {
    const r = pickRecipient('lead@x.com', [{ id: 'g', kind: 'general', title: null, email: 'acc@x.com', label: 'Accounts' }]);
    expect(r).toEqual({ email: 'lead@x.com', candidateId: null });
  });

  it('falls back to the first unmarked general inbox, curated before legacy, when the lead has no email', () => {
    const r = pickRecipient(null, [
      { id: 'legacy', kind: 'general', title: null, email: 'old@x.com', label: 'Additional email' },
      { id: 'g1', kind: 'general', title: null, email: 'acc@x.com', label: 'Accounts' },
      { id: 'g2', kind: 'general', title: null, email: 'sales@x.com', label: 'Sales' },
    ]);
    expect(r).toEqual({ email: 'acc@x.com', candidateId: 'g1' });
  });

  it('still ranks a named person above the lead own email', () => {
    const r = pickRecipient('lead@x.com', [{ id: 'p', kind: 'person', title: 'Clerk', email: 'p@x.com' }]);
    expect(r?.candidateId).toBe('p');
  });

  it('ranks the lead own email above migrated Additional email rows', () => {
    const r = pickRecipient('lead@x.com', [
      { id: 'g', kind: 'general', title: null, email: 'extra@x.com', label: 'Additional email' },
    ]);
    expect(r).toEqual({ email: 'lead@x.com', candidateId: null });
    const manual = pickRecipient('lead@x.com', [
      { id: 'g', kind: 'general', title: null, email: 'extra@x.com', label: 'X', source: 'manual', include_in_sequences: false },
    ]);
    expect(manual).toEqual({ email: 'lead@x.com', candidateId: null });
  });

  it('keeps a primary legacy row above the lead own email', () => {
    const r = pickRecipient('lead@x.com', [
      { id: 'g', kind: 'general', title: null, email: 'extra@x.com', label: 'Additional email', is_primary: true },
    ]);
    expect(r?.candidateId).toBe('g');
  });

  it('falls back to a legacy row when the lead has no valid email', () => {
    const r = pickRecipient(null, [
      { id: 'g', kind: 'general', title: null, email: 'extra@x.com', label: 'Additional email' },
    ]);
    expect(r).toEqual({ email: 'extra@x.com', candidateId: 'g' });
  });
});

describe('whitespace-only ids', () => {
  it('are treated as missing', () => {
    expect(pickSequence({ ...base, enrolledSequenceId: '  ', aiPickedId: 's2' })).toBe('s2');
    expect(pickSequence({ ...base, aiPickedId: '  ', icpId: 'icpA' })).toBe('s1');
    expect(pickSequence({ ...base, icpId: '  ' })).toBeNull();
  });
});
