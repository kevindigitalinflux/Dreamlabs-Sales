import { describe, expect, it } from 'vitest';
import { BLANK_DRAFT, firstIncompleteDraft, patchDraft, unionMissing } from './composerDrafts';
import type { RecipientDraft } from './composerDrafts';

const done = (over: Partial<RecipientDraft> = {}): RecipientDraft => ({ ...BLANK_DRAFT, subject: 'Hi', body: 'Hello there', ...over });

describe('patchDraft', () => {
  it('updates one recipient without touching the others, creating the draft if it is new', () => {
    const before = { a: done({ subject: 'A' }) };
    const after = patchDraft(before, 'b', { subject: 'B' });
    expect(after.a).toBe(before.a);
    expect(after.b).toEqual({ ...BLANK_DRAFT, subject: 'B' });
    expect(patchDraft(after, 'a', { body: 'new' }).a).toEqual({ ...before.a, body: 'new' });
    expect(before).toEqual({ a: before.a });
  });
});

describe('firstIncompleteDraft', () => {
  const targets = [{ key: 'a', email: 'a@x.com', name: 'Anna' }, { key: 'b', email: 'b@x.com', name: null }];

  it('is null when every recipient has a subject and body', () => {
    expect(firstIncompleteDraft(targets, { a: done(), b: done() })).toBeNull();
  });

  it('names the first recipient with no email yet (falling back to their address)', () => {
    expect(firstIncompleteDraft(targets, { a: done() })).toMatch(/b@x\.com/);
    expect(firstIncompleteDraft(targets, { a: done({ body: '  ' }), b: done() })).toMatch(/Anna/);
  });

  it('uses the plain message for a single recipient', () => {
    expect(firstIncompleteDraft([targets[0]!], {})).toBe('Subject and body are required.');
  });
});

describe('unionMissing', () => {
  it('combines the unfilled placeholders of the chosen recipients only, once each', () => {
    const targets = [{ key: 'a', email: 'a', name: null }, { key: 'b', email: 'b', name: null }];
    const drafts = { a: done({ missing: ['meet_link', 'pain_point'] }), b: done({ missing: ['meet_link'] }), c: done({ missing: ['other'] }) };
    expect(unionMissing(targets, drafts).sort()).toEqual(['meet_link', 'pain_point']);
  });
});
