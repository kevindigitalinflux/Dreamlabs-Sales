import { describe, expect, it } from 'vitest';
import { BLANK_DRAFT, firstIncompleteDraft, generationIdentity, patchDraft, unionMissing } from './composerDrafts';
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

describe('general inbox greeting', () => {
  const person = { key: 'p', email: 'p@x.com', name: 'Pat', kind: 'person' as const };
  const inbox = { key: 'g', email: 'info@x.com', name: null, kind: 'general' as const };

  it('does not report a missing first name for a general inbox', () => {
    const drafts = { g: done({ missing: ['first_name', 'meet_link'] }) };
    expect(unionMissing([inbox], drafts)).toEqual(['meet_link']);
  });

  it('still reports a missing first name for a person and for a target with no kind', () => {
    const drafts = { p: done({ missing: ['first_name'] }), l: done({ missing: ['first_name'] }) };
    expect(unionMissing([person], drafts)).toEqual(['first_name']);
    expect(unionMissing([{ key: 'l', email: 'l@x.com', name: null }], drafts)).toEqual(['first_name']);
  });

  it('keeps first_name when a person and an inbox are both ticked and the person lacks it', () => {
    const drafts = { p: done({ missing: ['first_name'] }), g: done({ missing: ['first_name'] }) };
    expect(unionMissing([person, inbox], drafts)).toEqual(['first_name']);
    expect(unionMissing([inbox], drafts)).toEqual([]);
  });
});

describe('generationIdentity', () => {
  it('greets a general inbox with "there" and sends no title', () => {
    expect(generationIdentity({ candidateId: 'c1', kind: 'general', name: null, title: null }))
      .toEqual({ recipient_name: 'there', recipient_title: undefined });
  });

  it('sends a named contact their own name and title', () => {
    expect(generationIdentity({ candidateId: 'c2', kind: 'person', name: 'Andrea Manning', title: 'Office Manager' }))
      .toEqual({ recipient_name: 'Andrea Manning', recipient_title: 'Office Manager' });
  });

  it('leaves the lead address and nothing-ticked unchanged', () => {
    const none = { recipient_name: undefined, recipient_title: undefined };
    expect(generationIdentity({ candidateId: null, kind: 'lead', name: 'Sarah', title: null })).toEqual(none);
    expect(generationIdentity({ candidateId: null, kind: 'extra', name: null, title: null })).toEqual(none);
    expect(generationIdentity(null)).toEqual(none);
  });
});
