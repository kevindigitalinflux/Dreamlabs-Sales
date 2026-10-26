import { expect, it } from 'vitest';
import { planSuggestionAdd, suggestionKey, visibleSuggestions } from '../../supabase/functions/_shared/deepFindSuggestions';
import { readDeepFindDetails } from './deepFindView';

const suggestion = { name: 'Jane Smith', field: 'person_phone', value: '+442079460958', label: 'Company line (switchboard)',
  phone: { value: '+442079460958', original: '020 7946 0958', kind: 'company_line' as const, source: 'own_site' as const, source_url: 'https://acme.test/contact', found_at: '2026-10-26T12:00:00Z' } };
const contact = { id: 'jane', first_name: 'Jane', last_name: 'Smith', phone: null, dismissed_at: null };
it('keeps the suggestion when the lead already has its company phone', () => {
  expect(visibleSuggestions([suggestion], { phone: suggestion.value }, [contact])).toEqual([suggestion]);
  expect(planSuggestionAdd(suggestion, {}, [contact])).toMatchObject({ kind: 'phone_update', id: 'jane', patch: { phone: suggestion.value, phone_kind: 'company_line', phone_source: 'own_site', phone_source_url: suggestion.phone.source_url, phone_found_at: suggestion.phone.found_at } });
});
it('suppresses a dismissed person or number, filled phone, and ambiguous person', () => {
  expect(suggestionKey(suggestion)).toBe('person_phone:jane smith:442079460958');
  for (const contacts of [[{ ...contact, dismissed_at: 'now' }], [{ ...contact, phone: '+442012345678' }], [contact, { ...contact, id: 'duplicate' }]]) {
    expect(planSuggestionAdd(suggestion, {}, contacts)).toEqual({ kind: 'none' });
  }
  expect(visibleSuggestions([suggestion], { dismissed_suggestions: [suggestionKey(suggestion)] }, [contact])).toEqual([]);
});
it('dismissal is person scoped for shared switchboards', () => {
  const second = { ...suggestion, name: 'John Jones' };
  expect(visibleSuggestions([suggestion, second], { dismissed_suggestions: [suggestionKey(suggestion)] }, [contact])).toEqual([second]);
});
it('creates a reviewed person without sequence enrolment or provider column edits', () => {
  expect(planSuggestionAdd(suggestion, {}, [])).toMatchObject({ kind: 'contact_insert', patch: { first_name: 'Jane', last_name: 'Smith', phone: suggestion.value, phone_kind: 'company_line', source: 'manual', include_in_sequences: false } });
});
it('round trips phone evidence through the defensive result parser', () => {
  expect(readDeepFindDetails({ suggestions: [suggestion] }).suggestions).toEqual([suggestion]);
  expect(readDeepFindDetails({ suggestions: [{ ...suggestion, phone: { ...suggestion.phone, kind: 'direct', source_url: 'javascript:alert(1)' } }] }).suggestions).toEqual([]);
});
