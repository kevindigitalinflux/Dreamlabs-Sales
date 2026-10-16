import { describe, expect, it } from 'vitest';
import { suggestionKey, isRoleMailbox, visibleSuggestions, planSuggestionAdd, registrySkipReason, countryPhoneMismatch } from '../../supabase/functions/_shared/deepFindSuggestions';

const email = { name: 'Company contact', value: ' HELLO@Example.com ', label: 'Found on site' };
const jane = { name: 'Jane Smith', role: 'Director' };
const contact = { id: 'c', first_name: 'Jane', last_name: 'Smith', email: null };
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
    expect(planSuggestionAdd(email, { email: 'saved@example.com', additional_emails: ['ONE@example.com', 'one@example.com'] }, [])).toEqual({ kind: 'lead_update', patch: { additional_emails: ['one@example.com', 'hello@example.com'] } });
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
