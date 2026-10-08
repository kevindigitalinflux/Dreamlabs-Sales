import { describe, expect, it } from 'vitest';
import {
  contactErrorMessage,
  contactToForm,
  editStrategy,
  emptyContactForm,
  newContactRow,
  primarySwitchPlan,
  validateContactForm,
} from './leadContacts';

const base = { email: 'a@x.com', first_name: 'Ann', last_name: 'Lee', name_obfuscated: false };

describe('editStrategy', () => {
  it('edits own rows in place, even when the email changes', () => {
    expect(editStrategy({ ...base, source: 'manual' }, { email: 'b@x.com' })).toBe('inline');
    expect(editStrategy({ ...base, source: 'dream_agent' }, { email: 'b@x.com' })).toBe('inline');
  });
  it('re-creates provider rows when the email changes', () => {
    for (const source of ['hunter', 'apollo', 'companies_house', 'cro'] as const) {
      expect(editStrategy({ ...base, source }, { email: 'b@x.com' })).toBe('dismiss_and_insert');
    }
  });
  it('treats a case or whitespace only email difference as unchanged', () => {
    expect(editStrategy({ ...base, source: 'hunter' }, { email: ' A@X.com ' })).toBe('inline');
  });
  it('adding an email to a registry row with none re-creates it', () => {
    expect(editStrategy({ ...base, email: null, source: 'companies_house' }, { email: 'a@x.com' })).toBe('dismiss_and_insert');
  });
  it('edits provider rows in place for non-email fields', () => {
    expect(editStrategy({ ...base, source: 'apollo' }, { first_name: 'Ann', last_name: 'Lee' })).toBe('inline');
    expect(editStrategy({ ...base, source: 'hunter' }, {})).toBe('inline');
  });
  it('re-creates a name-obfuscated row when the name changes, not otherwise', () => {
    const row = { ...base, source: 'apollo' as const, name_obfuscated: true, last_name: 'Le***' };
    expect(editStrategy(row, { last_name: 'Lewis' })).toBe('dismiss_and_insert');
    expect(editStrategy(row, { last_name: 'Le***' })).toBe('inline');
  });
  it('a changed name on a non-obfuscated provider row stays inline', () => {
    expect(editStrategy({ ...base, source: 'apollo' }, { last_name: 'Lewis' })).toBe('inline');
  });
});

describe('contactErrorMessage', () => {
  it('maps the duplicate email constraint', () => {
    const e = { code: '23505', message: 'duplicate key value violates unique constraint "decision_maker_candidates_lead_dedupe_key"' };
    expect(contactErrorMessage(e)).toBe('That email is already on this lead');
  });
  it('maps the one primary index', () => {
    const e = { code: '23505', message: 'x', details: 'violates "decision_maker_candidates_one_primary"' };
    expect(contactErrorMessage(e)).toBe('This lead already has a main contact; pick one first');
  });
  it('handles other unique violations, RLS no-ops and unknown errors', () => {
    expect(contactErrorMessage({ code: '23505', message: 'other' })).toBe('That contact already exists on this lead');
    expect(contactErrorMessage({ code: 'PGRST116', message: 'JSON object requested' })).toBe('You do not have permission to change this contact.');
    expect(contactErrorMessage({ message: 'boom' })).toBe('boom');
    expect(contactErrorMessage({})).toBe('Something went wrong saving this contact. Please try again.');
  });
});

describe('primarySwitchPlan', () => {
  const rows = [
    { id: 'a', is_primary: true, dismissed_at: null },
    { id: 'b', is_primary: false, dismissed_at: null },
    { id: 'c', is_primary: true, dismissed_at: '2026-01-01' },
  ];
  it('clears the live primary first, then sets the new one', () => {
    expect(primarySwitchPlan(rows, 'b')).toEqual({ clear: ['a'], set: 'b', restore: ['a'] });
  });
  it('does nothing when the target is already the live primary or unknown', () => {
    expect(primarySwitchPlan(rows, 'a')).toEqual({ clear: [], set: null, restore: [] });
    expect(primarySwitchPlan(rows, 'zzz')).toEqual({ clear: [], set: null, restore: [] });
  });
  it('ignores a dismissed primary and needs no clear when there is none', () => {
    const only = [{ id: 'c', is_primary: true, dismissed_at: 'x' }, { id: 'b', is_primary: false, dismissed_at: null }];
    expect(primarySwitchPlan(only, 'b')).toEqual({ clear: [], set: 'b', restore: [] });
  });
});

describe('form helpers', () => {
  it('validates a person and a general inbox', () => {
    const p = validateContactForm({ ...emptyContactForm('person'), first_name: ' Ann ', email: 'ANN@X.com' });
    expect(p).toEqual({ ok: true, value: expect.objectContaining({ first_name: 'Ann', email: 'ann@x.com', kind: 'person' }) });
    expect(validateContactForm(emptyContactForm('general'))).toEqual({ ok: false, error: 'Add a label for this inbox, for example Accounts.' });
  });
  it('round-trips a contact into form values', () => {
    const f = contactToForm({ kind: 'general', label: 'Accounts', email: 'a@x.com', first_name: null, last_name: null, title: null, phone: null, linkedin_url: null } as never);
    expect(f).toEqual({ kind: 'general', first_name: '', last_name: '', title: '', label: 'Accounts', email: 'a@x.com', phone: '', linkedin_url: '' });
  });
  it('builds a new manual row that is never primary', () => {
    const v = { kind: 'person', first_name: 'A', last_name: null, title: null, label: null, email: 'a@x.com', phone: null, linkedin_url: null } as const;
    expect(newContactRow('L', 'U', v, false)).toEqual({ ...v, lead_id: 'L', source: 'manual', created_by: 'U', include_in_sequences: false, is_primary: false });
    expect(newContactRow('L', 'U', v).include_in_sequences).toBe(true);
  });
});
