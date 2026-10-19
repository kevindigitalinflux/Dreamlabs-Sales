import { expect, it } from 'vitest';
import { planSuggestionAdd, suggestionKey, visibleSuggestions } from '../../supabase/functions/_shared/deepFindSuggestions';
const s = { name: 'Jane Smith', field: 'linkedin_url', value: 'https://www.linkedin.com/in/jane', label: 'Jane Smith may work at Acme.' };
it('keeps LinkedIn review distinct from email and permits only blank contact fills', () => {
  expect(suggestionKey(s)).toBe('linkedin_url:jane smith:https://www.linkedin.com/in/jane');
  expect(visibleSuggestions([s], {}, [])).toEqual([s]);
  expect(planSuggestionAdd(s, {}, [{ id: 'c', first_name: 'Jane', last_name: 'Smith', email: 'jane@acme.com' }])).toEqual({ kind: 'linkedin_update', id: 'c', patch: { linkedin_url: s.value } });
  expect(visibleSuggestions([s], {}, [{ id: 'c', first_name: 'Jane', last_name: 'Smith', linkedin_url: 'existing' }])).toEqual([]);
  expect(visibleSuggestions([s], { dismissed_suggestions: [suggestionKey(s)] }, [])).toEqual([]);
});
it('offers new people for manual review and refuses malformed profile URLs', () => {
  expect(planSuggestionAdd(s, {}, [])).toMatchObject({ kind: 'contact_insert', patch: { linkedin_url: s.value, email: null, include_in_sequences: false } });
  expect(visibleSuggestions([{ ...s, value: 'https://www.linkedin.com/company/acme' }], {}, [])).toEqual([]);
});
