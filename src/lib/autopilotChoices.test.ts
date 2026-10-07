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
    expect(r?.candidateId).toBe('b');
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
    for (const bad of ['nope', 'a@b', 'a b@c.com', '@c.com', 'a@', 'a@.com', 'a@c.', 'a@@c.com', 'a@c..com']) {
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
});
