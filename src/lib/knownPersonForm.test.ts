import { describe, expect, it } from 'vitest';
import {
  buildFromFullName, buildKnownPersonPayload, classifyMessages, needsFollowUpNotice, splitFullName, summariseKnownPerson,
} from './knownPersonForm';
import type { KnownPersonResult } from '../types';

const blank = { first_name: '', last_name: '', title: '', email: '', linkedin_url: '' };
const base: KnownPersonResult = {
  saved: true, contact_id: 'c1', found: {}, sources: {}, errors: [], notes: [], apollo_called: false, hunter_called: false,
};

describe('splitFullName', () => {
  it('splits two words', () => {
    expect(splitFullName('Andrea Manning')).toEqual({ ok: true, value: { first_name: 'Andrea', last_name: 'Manning' } });
  });
  it('gives everything after the first word to the last name', () => {
    expect(splitFullName('  Mary  Jane van der Berg ')).toEqual({ ok: true, value: { first_name: 'Mary', last_name: 'Jane van der Berg' } });
  });
  it('rejects a single word and blanks', () => {
    expect(splitFullName('Andrea')).toEqual({ ok: false, error: 'Enter the first and last name, for example Andrea Manning.' });
    expect(splitFullName('   ').ok).toBe(false);
  });
});

describe('buildKnownPersonPayload', () => {
  it('trims, drops blanks and omits use_paid_lookups when on', () => {
    const r = buildKnownPersonPayload({ ...blank, first_name: ' Andrea ', last_name: 'Manning', title: ' Owner ' }, true);
    expect(r).toEqual({ ok: true, value: { first_name: 'Andrea', last_name: 'Manning', title: 'Owner' } });
  });
  it('lowercases the email and sends use_paid_lookups only when false', () => {
    const r = buildKnownPersonPayload({ ...blank, first_name: 'A', last_name: 'M', email: ' A@Example.com ' }, false);
    expect(r).toEqual({ ok: true, value: { first_name: 'A', last_name: 'M', email: 'a@example.com', use_paid_lookups: false } });
  });
  it('reports validation errors in plain English', () => {
    expect(buildKnownPersonPayload(blank, true)).toEqual({ ok: false, error: 'Add a first or last name for this person.' });
    expect(buildKnownPersonPayload({ ...blank, first_name: 'A', last_name: 'M', email: 'nope' }, true).ok).toBe(false);
  });
  it('builds from a full name', () => {
    expect(buildFromFullName('Andrea Manning', { title: '', email: '', linkedin_url: '' }, true))
      .toEqual({ ok: true, value: { first_name: 'Andrea', last_name: 'Manning' } });
    expect(buildFromFullName('Andrea', { title: '', email: '', linkedin_url: '' }, true).ok).toBe(false);
  });
});

describe('summariseKnownPerson', () => {
  const typed = { first_name: 'Andrea', last_name: 'Manning', title: 'Owner', email: 'a@x.com' };
  it('lists typed and found values with their sources', () => {
    const s = summariseKnownPerson({
      ...base, found: { phone: '0123', linkedin_url: 'https://linkedin.com/in/a' },
      sources: { phone: 'apollo', linkedin_url: 'hunter' }, apollo_called: true, hunter_called: true,
    }, typed);
    expect(s.heading).toBe('Saved Andrea Manning');
    expect(s.lines).toEqual([
      { label: 'Position', value: 'Owner', source: 'You' },
      { label: 'Email', value: 'a@x.com', source: 'You' },
      { label: 'Phone', value: '0123', source: 'Apollo' },
      { label: 'LinkedIn', value: 'https://linkedin.com/in/a', source: 'Hunter' },
    ]);
    expect(s.lookups).toEqual(['Hunter used', 'Apollo used (1 credit)']);
  });
  it('says when no paid lookup ran', () => {
    expect(summariseKnownPerson(base, typed).lookups).toEqual(['Hunter not used', 'Apollo not used']);
  });
});

describe('classifyMessages', () => {
  it('dedupes and keeps errors apart from notes', () => {
    expect(classifyMessages(['Bad ', 'Bad', ''], ['Bad', 'FYI'])).toEqual({ errors: ['Bad'], notes: ['FYI'] });
    expect(classifyMessages(undefined, undefined)).toEqual({ errors: [], notes: [] });
  });
});

describe('needsFollowUpNotice', () => {
  it('flags only search-found contacts that are off sequences', () => {
    expect(needsFollowUpNotice({ source: 'hunter', include_in_sequences: false })).toBe(true);
    expect(needsFollowUpNotice({ source: 'hunter', include_in_sequences: true })).toBe(false);
    expect(needsFollowUpNotice({ source: 'manual', include_in_sequences: false })).toBe(false);
    expect(needsFollowUpNotice(null)).toBe(false);
  });
});
