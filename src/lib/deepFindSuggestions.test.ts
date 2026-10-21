import { describe, expect, it } from 'vitest';
import { suggestionKey, isRoleMailbox, visibleSuggestions, planSuggestionAdd, registrySkipReason, countryPhoneMismatch } from '../../supabase/functions/_shared/deepFindSuggestions';

const email = { name: 'Company contact', value: ' HELLO@Example.com ', label: 'Found on site' };
const jane = { name: 'Jane Smith', role: 'Director' };
const contact = { id: 'c', first_name: 'Jane', last_name: 'Smith', email: null };
it('shows invalid saved-email replacements only while the exact contact and address still match', () => {
  const saved = { ...contact, email: 'jane.smith@example.com' };
  const suggestion = { name: 'Jane Smith', field: 'email', value: 'jane@example.com', guess_rank: 'most_likely' as const,
    replaces_saved_email: { contact_id: 'c', email: saved.email } };
  expect(visibleSuggestions([suggestion], {}, [saved])).toEqual([suggestion]);
  expect(planSuggestionAdd(suggestion, {}, [saved])).toMatchObject({ kind: 'contact_update', id: 'c', patch: { email: suggestion.value, include_in_sequences: false } });
  for (const changed of [{ ...saved, email: 'new@example.com' }, { ...saved, dismissed_at: 'today' }, { ...saved, id: 'other' }]) {
    expect(visibleSuggestions([suggestion], {}, [changed])).toEqual([]);
    expect(planSuggestionAdd(suggestion, {}, [changed])).toEqual({ kind: 'none' });
  }
  expect(visibleSuggestions([suggestion], { dismissed_suggestions: ['email:jane@example.com'] }, [saved])).toEqual([]);
  expect(visibleSuggestions([suggestion], {}, [saved, { ...saved, id: 'duplicate' }])).toEqual([]);
});
describe('Deep find review rules', () => {
  it('normalises stable email and person keys', () => {
    expect(suggestionKey(email)).toBe('email:hello@example.com');
    expect(suggestionKey({ name: ' Jane   SMITH ' })).toBe('person:jane smith');
  });
  it.each(['privacy','gdpr','dpo','legal','compliance','careers','jobs','recruitment','press','media','abuse','postmaster','webmaster','noreply','no-reply','donotreply','unsubscribe'])('labels %s as a role mailbox', (local) => {
    expect(isRoleMailbox(`${local.toUpperCase()}@example.com`)).toBe(true);
  });
  it.each(['hello','info','contact','enquiries','sales','office','admin','team','support','privacy.team'])('keeps %s in the main list', (local) => {
    expect(isRoleMailbox(`${local}@example.com`)).toBe(false);
  });
  it('orders role mailboxes last, retaining useful order and removing duplicate shapes', () => {
    const privacy = { ...email, value: 'privacy@example.com' };
    expect(visibleSuggestions([privacy, email, jane, { ...email, value: 'hello@example.com' }, jane], {}, [])).toEqual([email, jane, privacy]);
  });
  it('filters remembered dismissals, primary/additional emails and contacts including dismissed contacts', () => {
    expect(visibleSuggestions([email, jane], { dismissed_suggestions: ['email:hello@example.com','person:jane smith'] }, [])).toEqual([]);
    expect(visibleSuggestions([email], { email: 'HELLO@example.com' }, [])).toEqual([]);
    expect(visibleSuggestions([email], { additional_emails: ['HELLO@example.com'] }, [])).toEqual([]);
    expect(visibleSuggestions([email, jane], {}, [{ ...contact, email: 'hello@example.com', dismissed_at: 'today' }])).toEqual([]);
  });
  it('fills an existing named contact with no email, with follow-ups off', () => {
    expect(planSuggestionAdd({ ...email, name: 'Jane Smith' }, {}, [contact])).toEqual({ kind: 'contact_update', id: 'c', patch: { email: 'hello@example.com', include_in_sequences: false } });
    expect(planSuggestionAdd({ ...email, name: 'Jane Smith' }, {}, [{ ...contact, email: 'saved@example.com' }])).toEqual({ kind: 'none' });
  });
  it('creates named people with or without an address and follow-ups off', () => {
    expect(planSuggestionAdd(jane, {}, [])).toMatchObject({ kind: 'contact_insert', patch: { first_name: 'Jane', last_name: 'Smith', title: 'Director', email: null, include_in_sequences: false, source: 'manual' } });
    expect(planSuggestionAdd({ ...email, name: 'Jane Smith' }, {}, [])).toMatchObject({ kind: 'contact_insert', patch: { email: 'hello@example.com', include_in_sequences: false } });
  });
  it('sets a blank primary or appends a company email without overwriting', () => {
    expect(planSuggestionAdd(email, {}, [])).toEqual({ kind: 'lead_update', patch: { email: 'hello@example.com' } });
    expect(planSuggestionAdd(email, { email: 'saved@example.com', additional_emails: ['ONE@example.com', 'one@example.com', '', ' legacy value '] }, [])).toEqual({ kind: 'lead_update', patch: { additional_emails: ['ONE@example.com', 'one@example.com', '', ' legacy value ', 'HELLO@Example.com'] } });
  });
  it('dedupes new addresses case-insensitively without rewriting existing entries', () => {
    expect(planSuggestionAdd(email, { email: 'saved@example.com', additional_emails: ['HELLO@example.com', ' legacy value ', ''] }, [])).toEqual({ kind: 'none' });
  });
  it('ignores malformed emails, unsupported fields and blank names', () => {
    expect(visibleSuggestions([{ name: '', value: 'a@example.com' }, { ...email, field: 'linkedin_url' }, { ...email, value: 'bad' }], {}, [])).toEqual([]);
  });
});
describe('country rules', () => {
  it('preserves null/GB registry behaviour and skips foreign or rejected choices', () => {
    expect(registrySkipReason({})).toBeNull();
    expect(registrySkipReason({ country: null })).toBeNull();
    expect(registrySkipReason({ country: 'GB' })).toBeNull();
    expect(registrySkipReason({ country: 'IE' })).toBe('not_uk');
    expect(registrySkipReason({ registry_candidates_rejected: true })).toBe('rejected');
  });
  it('accepts Irish and US prefixes, skips OTHER and flags mismatched countries', () => {
    expect(countryPhoneMismatch('+353 1 234 5678', 'IE')).toBe(false);
    expect(countryPhoneMismatch('087 123 4567', 'IE')).toBe(false);
    expect(countryPhoneMismatch('+1 (212) 555-1234', 'US')).toBe(false);
    expect(countryPhoneMismatch('+44 20 1234 5678', 'US')).toBe(true);
    expect(countryPhoneMismatch('+33 1 234 5678', 'OTHER')).toBe(false);
    expect(countryPhoneMismatch('No phones', 'US')).toBe(false);
  });
});
import { isOwnerRole, roleForPerson, planOwnerFromSuggestion } from '../../supabase/functions/_shared/deepFindSuggestions';
describe('owner from suggestion', () => {
  it.each(['Owner', 'Founder', 'co-founder', 'Co Founder', 'Founder and CEO', 'CEO', 'Chief Executive Officer', 'Managing Director', 'Proprietor', 'Owner/Director'])('%s is owner-like', (r) => expect(isOwnerRole(r)).toBe(true));
  it.each(['Principal', 'Director', 'Marketing Manager', 'Head of Sales', 'Founders club coordinator', 'Office manager', '', null, undefined])('%j is not owner-like', (r) => expect(isOwnerRole(r)).toBe(false));
  it('matches a name to a role ignoring case, accents and spacing', () => {
    expect(roleForPerson('valentina  ANTUNOVIC', [{ name: 'Valentína Antunovic', role: ' Founder ' }])).toBe('Founder');
    expect(roleForPerson('Jo', [{ name: 'Jane', role: 'CEO' }])).toBeNull();
    expect(roleForPerson('Jane Smith', [], [{ id: 'c', first_name: 'Jane', last_name: 'Smith', title: 'Owner' }])).toBe('Owner');
  });
  it('plans the trimmed name only for a blank owner, a person and an owner-like role', () => {
    const p = { name: '  Jane   Smith ', value: 'j@x.com' };
    expect(planOwnerFromSuggestion(p, 'Founder', {})).toBe('Jane Smith');
    expect(planOwnerFromSuggestion(p, 'Founder', { owner_name: '  ' })).toBe('Jane Smith');
    expect(planOwnerFromSuggestion(p, 'Founder', { owner_name: 'Bob' })).toBeNull();
    expect(planOwnerFromSuggestion(p, null, {})).toBeNull();
    expect(planOwnerFromSuggestion(p, 'Manager', {})).toBeNull();
    expect(planOwnerFromSuggestion({ name: 'Company contact', value: 'a@b.com' }, 'Owner', {})).toBeNull();
  });
});
