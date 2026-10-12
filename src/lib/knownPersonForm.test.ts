import { describe, expect, it } from 'vitest';
import {
  buildFromFullName, buildKnownPersonPayload, classifyMessages, decidePhoneSave, namePreview, needsFollowUpNotice, resolveName,
  planSuggestionUse, splitFullName, stepLine, summariseKnownPerson, visibleSuggestions,
} from './knownPersonForm';
import type { DecisionMakerCandidate, KnownPersonResult, KnownPersonStep } from '../types';

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
    expect(s.lookups).toEqual(['Hunter used', 'Apollo used']);
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

describe('name preview and override', () => {
  it('previews the split', () => {
    expect(namePreview('Mary Jane van der Berg')).toBe('First name: Mary, Last name: Jane van der Berg');
    expect(namePreview('Andrea')).toBeNull();
  });
  it('the hand-edited names win over the split', () => {
    const o = { first_name: 'Mary Jane', last_name: 'van der Berg' };
    expect(resolveName('Mary Jane van der Berg', o)).toEqual({ ok: true, value: o });
    expect(resolveName('Mary Jane van der Berg', null)).toEqual({ ok: true, value: { first_name: 'Mary', last_name: 'Jane van der Berg' } });
    expect(buildFromFullName('Mary Jane van der Berg', { title: '', email: '', linkedin_url: '' }, true, o))
      .toEqual({ ok: true, value: { first_name: 'Mary Jane', last_name: 'van der Berg' } });
    expect(buildFromFullName('Andrea', { title: '', email: '', linkedin_url: '' }, true, { first_name: 'Andrea', last_name: 'Manning' }).ok).toBe(true);
  });
  it('sends use_paid_lookups false through buildFromFullName', () => {
    expect(buildFromFullName('Andrea Manning', { title: '', email: '', linkedin_url: '' }, false))
      .toEqual({ ok: true, value: { first_name: 'Andrea', last_name: 'Manning', use_paid_lookups: false } });
  });
  it('HOK end to end', () => {
    expect(buildFromFullName('Andrea Manning', { title: ' Office Manager ', email: 'Andrea.Manning@hok.com', linkedin_url: '' }, true))
      .toEqual({ ok: true, value: { first_name: 'Andrea', last_name: 'Manning', title: 'Office Manager', email: 'andrea.manning@hok.com' } });
  });
});

describe('decidePhoneSave', () => {
  it('saves into a blank row, skips blanks and matches, notes a different provider number', () => {
    expect(decidePhoneSave(' 0123 ', null)).toEqual({ action: 'save', phone: '0123' });
    expect(decidePhoneSave('0123', '')).toEqual({ action: 'save', phone: '0123' });
    expect(decidePhoneSave('  ', '999')).toEqual({ action: 'skip' });
    expect(decidePhoneSave('0123', '0123')).toEqual({ action: 'skip' });
    expect(decidePhoneSave('0123', '999')).toEqual({
      action: 'note', note: 'A search already found the phone number 999, so the number you typed (0123) was not saved.',
    });
  });
});

describe('summariseKnownPerson details', () => {
  const typed = { first_name: 'Andrea', last_name: 'Manning', email: 'typed@x.com' };
  it('shows the found value, not the typed one, when they conflict', () => {
    const s = summariseKnownPerson({ ...base, found: { email: 'found@x.com' }, sources: { email: 'hunter' } }, typed);
    expect(s.lines).toEqual([{ label: 'Email', value: 'found@x.com', source: 'Hunter' }]);
  });
  it('falls back to Search when a found value has no source', () => {
    const s = summariseKnownPerson({ ...base, found: { phone: '0123' } }, { first_name: 'A', last_name: 'M' });
    expect(s.lines).toEqual([{ label: 'Phone', value: '0123', source: 'Search' }]);
  });
  it('prefers the saved contact row and credits a typed phone to You', () => {
    const s = summariseKnownPerson(base, typed, { title: 'Owner', email: 'typed@x.com', phone: '0777', linkedin_url: null }, '0777');
    expect(s.lines).toEqual([
      { label: 'Position', value: 'Owner', source: 'You' },
      { label: 'Email', value: 'typed@x.com', source: 'You' },
      { label: 'Phone', value: '0777', source: 'You' },
    ]);
  });
  it('keeps extra_email out of the lines and the summary otherwise intact', () => {
    const s = summariseKnownPerson({ ...base, extra_email: 'second@x.com', errors: ['Hunter failed'], notes: ['FYI'] }, typed);
    expect(s.lines.map((l) => l.value)).toEqual(['typed@x.com']);
    expect(s.errors).toEqual(['Hunter failed']);
    expect(s.notes).toEqual(['FYI']);
  });
});

const step = (id: KnownPersonStep['id'], status: KnownPersonStep['status'], detail = 'd'): KnownPersonStep => ({ id, label: id, status, detail });

describe('lookup steps in the summary', () => {
  const typed = { first_name: 'John', last_name: 'Sipple' };
  it('shows each step on its own line instead of the old Hunter/Apollo line', () => {
    const s = summariseKnownPerson({
      ...base, steps: [step('hunter_finder', 'found'), step('hunter_domain', 'no_match'), step('apollo', 'unavailable'), step('web', 'error')],
    }, typed);
    expect(s.lookups).toEqual([]);
    expect(s.steps.map((l) => [l.id, l.tone])).toEqual([
      ['hunter_finder', 'found'], ['hunter_domain', 'muted'], ['apollo', 'muted'], ['web', 'error'],
    ]);
  });
  it('labels the new sources', () => {
    const s = summariseKnownPerson({ ...base, steps: [], found: { email: 'j@x.com', linkedin_url: 'https://www.linkedin.com/in/j' }, sources: { email: 'website', linkedin_url: 'pattern' } }, typed);
    expect(s.lines.map((l) => l.source)).toEqual(['Company website', 'Email pattern']);
  });
  it('treats Apollo being unavailable as muted', () => {
    expect(stepLine(step('apollo', 'unavailable', 'Apollo is not available on this plan, so it was skipped.')).tone).toBe('muted');
  });
});

const person = (over: Partial<DecisionMakerCandidate> = {}): DecisionMakerCandidate => ({
  id: 'c1', lead_id: 'l1', source: 'manual', kind: 'person', label: null, is_primary: false, include_in_sequences: true,
  apollo_person_id: null, first_name: 'John', last_name: 'Sipple', name_obfuscated: false, title: null, email: null,
  email_revealed: false, phone: null, phone_status: 'not_requested', linkedin_url: null, dismissed_at: null,
  created_at: '', updated_at: '', ...over,
});

describe('suggestions', () => {
  const email = { field: 'email' as const, value: 'john@x.com', label: 'Guess, unverified' };
  const link = { field: 'linkedin_url' as const, value: 'https://www.linkedin.com/in/js', label: 'Found by web search, check it' };

  it('only offers suggestions for blank fields, once each', () => {
    expect(visibleSuggestions({ suggestions: [email, { ...email, value: 'JOHN@x.com' }, link] }, person({ linkedin_url: 'https://www.linkedin.com/in/a' })))
      .toEqual([email]);
    expect(visibleSuggestions({})).toEqual([]);
  });

  it('fills a blank email and switches follow-ups off', () => {
    const plan = planSuggestionUse(person(), email);
    expect(plan.ok && plan.form.email).toBe('john@x.com');
    expect(plan.ok && plan.switchOffAfter).toBe(true);
    expect(plan.ok && plan.contact.include_in_sequences).toBe(false);
  });

  it('passes follow-ups off into a provider row that is re-saved as a new contact', () => {
    const plan = planSuggestionUse(person({ source: 'hunter', include_in_sequences: true }), email);
    expect(plan.ok && plan.switchOffAfter).toBe(false);
    expect(plan.ok && plan.contact.include_in_sequences).toBe(false);
  });

  it('leaves follow-ups alone for a LinkedIn link and refuses a filled field', () => {
    const plan = planSuggestionUse(person(), link);
    expect(plan.ok && plan.switchOffAfter).toBe(false);
    expect(plan.ok && plan.contact.include_in_sequences).toBe(true);
    expect(planSuggestionUse(person({ email: 'a@x.com' }), email)).toEqual({ ok: false, error: 'This person already has an email, so the suggestion was not used.' });
    expect(planSuggestionUse(undefined, email).ok).toBe(false);
  });
});
