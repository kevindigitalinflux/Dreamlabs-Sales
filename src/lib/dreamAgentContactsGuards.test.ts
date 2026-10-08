import { describe, expect, it } from 'vitest';
import { sanitizeDreamAgentActions } from './dreamAgentActions';
import {
  DUPLICATE_EMAIL_MESSAGE, contactLeadIds, draftProblem, planContactSteps, selectApplicable, withoutContactActions,
} from './dreamAgentContacts';
import type { ContactAction, ContactDraft, ContactIndex } from './dreamAgentContacts';
import { applyContactSteps } from './dreamAgentContactApply';
import { validateContactEdit } from '../../supabase/functions/_shared/contacts';
import type { DecisionMakerCandidate } from '../types';

const LEADS = new Set(['lead-1', 'lead-2']);

function contact(over: Partial<DecisionMakerCandidate>): DecisionMakerCandidate {
  return {
    id: 'c-1', lead_id: 'lead-1', source: 'manual', kind: 'person', label: null, is_primary: false, include_in_sequences: true,
    apollo_person_id: null, first_name: 'Sam', last_name: 'Lee', name_obfuscated: false, title: 'Owner', email: 'sam@acme.com',
    email_revealed: false, phone: null, phone_status: 'not_requested', linkedin_url: null, dismissed_at: null,
    created_at: '2026-01-01', updated_at: '2026-01-01', ...over,
  };
}
const INDEX: ContactIndex = { 'lead-1': [contact({ id: 'c-1' }), contact({ id: 'c-2', first_name: 'Pat', email: 'pat@acme.com' })], 'lead-2': [] };
const draft = (over: Partial<ContactDraft> = {}): ContactDraft => ({
  first_name: 'Ann', last_name: 'Ray', title: '', label: '', email: 'ann@acme.com', phone: '', make_primary: false, include_in_sequences: true, ...over,
});
const run = (raw: unknown[], index: ContactIndex = INDEX) => sanitizeDreamAgentActions(raw, LEADS, undefined, undefined, index);
const add = (over: Record<string, unknown> = {}) => ({ type: 'add_contact', lead_id: 'lead-1', kind: 'person', first_name: 'Ann', last_name: 'Ray', email: 'ann@acme.com', excerpt: 'x', rationale: 'y', ...over });

describe('selectApplicable (gate on the CURRENT draft, not the AI flag)', () => {
  const invalidAction = run([add({ email: 'bad' })])[0] as ContactAction;

  it('applies an AI-flagged row once the user fixed it', () => {
    expect(invalidAction.invalid).toBe('That email address does not look right.');
    const { steps, skipped } = selectApplicable([{ index: 0, action: invalidAction, draft: draft({ email: 'ann@acme.com' }) }], INDEX);
    expect(skipped).toEqual([]);
    expect(steps).toEqual([{ index: 0, type: 'add', leadId: 'lead-1', contactId: undefined, kind: 'person', draft: draft() }]);
  });

  it('skips a still-invalid row with a visible reason', () => {
    const { steps, skipped } = selectApplicable([{ index: 3, action: invalidAction, draft: draft({ email: 'still bad' }) }], INDEX);
    expect(steps).toEqual([]);
    expect(skipped).toEqual([{ index: 3, name: 'Ann Ray', reason: 'That email address does not look right.' }]);
  });

  it('skips an add whose email another live contact already has', () => {
    const action = run([add()])[0] as ContactAction;
    const { skipped } = selectApplicable([{ index: 0, action, draft: draft({ email: 'PAT@acme.com' }) }], INDEX);
    expect(skipped[0].reason).toBe(DUPLICATE_EMAIL_MESSAGE);
  });

  it('skips an update whose contact has gone, and an update to a taken email', () => {
    const upd = run([{ type: 'update_contact', lead_id: 'lead-1', contact_id: 'c-1', patch: { phone: '020 7946 0000' }, excerpt: '', rationale: '' }])[0] as ContactAction;
    expect(selectApplicable([{ index: 0, action: upd, draft: draft() }], { 'lead-1': [] }).skipped[0].reason).toBe('That contact is no longer on this lead.');
    expect(selectApplicable([{ index: 0, action: upd, draft: draft({ email: 'pat@acme.com' }) }], INDEX).skipped[0].reason).toBe(DUPLICATE_EMAIL_MESSAGE);
    expect(selectApplicable([{ index: 0, action: upd, draft: draft({ first_name: 'Sam', email: 'sam@acme.com' }) }], INDEX).steps.length).toBe(1);
  });
});

describe('draftProblem duplicates', () => {
  it('flags an email another contact has, ignoring case and dismissed contacts', () => {
    const others = [contact({ id: 'x', email: 'Dup@acme.com' }), contact({ id: 'y', email: 'gone@acme.com', dismissed_at: '2026-01-01' })];
    expect(draftProblem('person', draft({ email: 'dup@ACME.com' }), others)).toBe(DUPLICATE_EMAIL_MESSAGE);
    expect(draftProblem('person', draft({ email: 'gone@acme.com' }), others)).toBeNull();
    expect(draftProblem('person', draft({ email: '' }), others)).toBeNull();
  });
});

describe('raw action helpers', () => {
  const raw = [add(), add({ lead_id: 'nope' }), { type: 'update', lead_id: 'lead-2' }, { type: 'update_contact', lead_id: 'lead-2', contact_id: 'z' }, 'junk', null];
  it('lists only known leads named by contact actions', () => {
    expect(contactLeadIds(raw, LEADS).sort()).toEqual(['lead-1', 'lead-2']);
    expect(contactLeadIds('nope', LEADS)).toEqual([]);
  });
  it('removes contact actions and keeps the rest', () => {
    expect(withoutContactActions(raw)).toEqual([{ type: 'update', lead_id: 'lead-2' }, 'junk', null]);
  });
});

describe('applyContactSteps duplicates', () => {
  function client(rows: DecisionMakerCandidate[], log: string[]) {
    let n = 0;
    const table = {
      insert: (r: Record<string, unknown>) => ({ select: () => ({ single: async () => { const made = contact({ ...(r as Partial<DecisionMakerCandidate>), id: `new-${++n}` }); rows.push(made); log.push(`insert:${made.id}`); return { data: made, error: null }; } }) }),
      update: (patch: Record<string, unknown>) => ({ eq: (_c: string, id: string) => ({ select: () => ({ single: async () => { Object.assign(rows.find((x) => x.id === id) ?? {}, patch); log.push(`update:${id}`); return { data: { ...rows.find((x) => x.id === id) }, error: null }; } }) }) }),
    };
    return { from: () => table } as unknown as Parameters<typeof applyContactSteps>[0]['client'];
  }
  const base = (c: Parameters<typeof applyContactSteps>[0]['client']) => ({ client: c, userId: 'u', dismiss: async () => null });

  it('fails an add whose email is already on a live contact, writing nothing', async () => {
    const rows = [contact({ id: 'c-1', email: 'sam@acme.com' })]; const log: string[] = [];
    const steps = planContactSteps([{ index: 0, type: 'add', leadId: 'lead-1', kind: 'person', draft: draft({ email: 'SAM@acme.com' }) }]);
    const res = await applyContactSteps(base(client(rows, log)), steps, { 'lead-1': [...rows] });
    expect(res).toEqual([{ index: 0, ok: false, message: DUPLICATE_EMAIL_MESSAGE }]);
    expect(log).toEqual([]);
  });

  it('catches a duplicate created earlier in the same batch', async () => {
    const rows: DecisionMakerCandidate[] = []; const log: string[] = [];
    const steps = planContactSteps([
      { index: 0, type: 'add', leadId: 'lead-1', kind: 'person', draft: draft() },
      { index: 1, type: 'add', leadId: 'lead-1', kind: 'person', draft: draft({ first_name: 'Other' }) },
    ]);
    const res = await applyContactSteps(base(client(rows, log)), steps, {});
    expect(res.map((r) => r.ok)).toEqual([true, false]);
    expect(log).toEqual(['insert:new-1']);
  });

  it('fails an email-changing update to a taken address but allows an unchanged email', async () => {
    const rows = [contact({ id: 'c-1' }), contact({ id: 'c-2', email: 'pat@acme.com' })]; const log: string[] = [];
    const steps = planContactSteps([
      { index: 0, type: 'update', leadId: 'lead-1', contactId: 'c-1', kind: 'person', draft: draft({ first_name: 'Sam', last_name: 'Lee', email: 'pat@acme.com' }) },
      { index: 1, type: 'update', leadId: 'lead-1', contactId: 'c-2', kind: 'person', draft: draft({ first_name: 'Pat', last_name: 'Lee', title: 'Boss', email: 'pat@acme.com' }) },
    ]);
    const res = await applyContactSteps(base(client(rows, log)), steps, { 'lead-1': [...rows] });
    expect(res[0]).toEqual({ index: 0, ok: false, message: DUPLICATE_EMAIL_MESSAGE });
    expect(res[1].ok).toBe(true);
  });
});

describe('adversarial sanitizer input', () => {
  it('ignores non-string values and non-object patches', () => {
    const out = run([
      add({ email: 12345, first_name: ['Ann'], last_name: { x: 1 }, title: 7 }),
      { type: 'update_contact', lead_id: 'lead-1', contact_id: 'c-1', patch: ['phone', '1'], excerpt: 1, rationale: [] },
      { type: 'update_contact', lead_id: 'lead-1', contact_id: 'c-1', patch: 'phone=1' },
      { type: 'update_contact', lead_id: ['lead-1'], contact_id: 'c-1', patch: { phone: '12345' } },
      { type: 'update_contact', lead_id: 'lead-1', contact_id: { id: 'c-1' }, patch: { phone: '12345' } },
    ]);
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({ type: 'add_contact', invalid: 'Add a first or last name for this person.', excerpt: 'x', rationale: 'y' });
    expect(out[0]).not.toHaveProperty('email');
  });

  it('treats __proto__ and constructor keys as ordinary unknown keys', () => {
    const evil = JSON.parse('{"type":"add_contact","lead_id":"lead-1","kind":"person","first_name":"Ann","__proto__":{"source":"hunter"},"constructor":{"x":1},"patch":{"__proto__":{"is_primary":true}}}');
    const [a] = run([evil]);
    expect(Object.keys(a).sort()).toEqual(['excerpt', 'first_name', 'kind', 'lead_id', 'rationale', 'type']);
    expect(({} as Record<string, unknown>).source).toBeUndefined();
    expect(run([{ type: 'add_contact', lead_id: '__proto__', kind: 'person', first_name: 'A' }, { type: 'add_contact', lead_id: 'constructor', kind: 'general', label: 'x' }])).toEqual([]);
  });

  it('flags over-long strings instead of keeping them', () => {
    const [a] = run([add({ first_name: 'A'.repeat(5000) })]) as ContactAction[];
    expect(a).toMatchObject({ invalid: 'First name must be 80 characters or fewer.' });
    expect(a.type === 'add_contact' && a.first_name?.length).toBe(500);
  });

  it('flags zero-width and bidi characters and non-ASCII emails', () => {
    for (const ch of ['​', '‎', '‮', '⁦', '⁠', '﻿']) {
      expect(run([add({ first_name: `An${ch}n` })])[0], JSON.stringify(ch)).toMatchObject({ invalid: 'First name cannot contain line breaks or other control characters.' });
      expect(run([add({ email: `an${ch}n@acme.com` })])[0], JSON.stringify(ch)).toHaveProperty('invalid');
    }
    expect(run([add({ email: 'ann@exämple.com' })])[0]).toMatchObject({ invalid: 'That email address does not look right.' });
    expect(run([add({ email: 'änn@acme.com' })])[0]).toMatchObject({ invalid: 'That email address does not look right.' });
  });

  it('ignores lead_id, source and contact_id inside an update patch', () => {
    const [a] = run([{ type: 'update_contact', lead_id: 'lead-1', contact_id: 'c-1', patch: { phone: '020 7946 0000', lead_id: 'lead-2', contact_id: 'c-9', source: 'hunter', created_by: 'u' }, excerpt: '', rationale: '' }]);
    expect(a).toEqual({ type: 'update_contact', lead_id: 'lead-1', contact_id: 'c-1', patch: { phone: '020 7946 0000' }, excerpt: '', rationale: '' });
  });
});

describe('validator hardening', () => {
  it('accepts accented names but rejects hidden characters and non-ASCII addresses', () => {
    expect(validateContactEdit({ kind: 'person', first_name: 'José', email: 'jose@acme.com' }).ok).toBe(true);
    expect(validateContactEdit({ kind: 'person', first_name: 'José', email: 'josé@acme.com' }).ok).toBe(false);
    expect(validateContactEdit({ kind: 'person', first_name: 'A​b' }).ok).toBe(false);
    expect(validateContactEdit({ kind: 'general', label: 'Re‮ception' }).ok).toBe(false);
  });
});
