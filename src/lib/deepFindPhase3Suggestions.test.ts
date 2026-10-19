import { expect, it } from 'vitest';
import { planSuggestionAdd, suggestionKey, visibleSuggestions } from '../../supabase/functions/_shared/deepFindSuggestions';
import { readDeepFindDetails } from './deepFindView';

it.each(['phone', 'owner_name', 'website'] as const)('preserves reviewable %s proposals and supports Add/Dismiss', (field) => {
  const value = field === 'phone' ? '+441234567890' : field === 'website' ? 'https://acme.com' : 'Jane Smith';
  const suggestion = { name: 'Company contact', field, value, label: 'Check this source' };
  expect(readDeepFindDetails({ suggestions: [suggestion] }).suggestions).toEqual([suggestion]);
  expect(planSuggestionAdd(suggestion, {}, [])).toEqual({ kind: 'lead_update', patch: { [field]: value } });
  expect(visibleSuggestions([suggestion], { [field]: 'saved' }, [])).toEqual([]);
  expect(visibleSuggestions([suggestion], { dismissed_suggestions: [suggestionKey(suggestion)] }, [])).toEqual([]);
});

it('offers uncertain provider titles only for an existing blank, non-dismissed contact', () => {
  const s = { name: 'Jane Smith', field: 'title', value: 'Founder', label: 'Provider role' };
  const c = { id: 'contact', first_name: 'Jane', last_name: 'Smith', title: null };
  expect(planSuggestionAdd(s, {}, [c])).toEqual({ kind: 'title_update', id: 'contact', patch: { title: 'Founder' } });
  expect(visibleSuggestions([s], {}, [{ ...c, title: 'Director' }])).toEqual([]);
  expect(visibleSuggestions([s], {}, [{ ...c, dismissed_at: 'date' }])).toEqual([]);
});

it.each(['1', 'not a number'])('drops malformed phone proposal %s before offering a write', (value) => {
  const s = { name: 'Company contact', field: 'phone', value, label: 'Provider phone' };
  expect(readDeepFindDetails({ suggestions: [s] }).suggestions).toEqual([]);
  expect(planSuggestionAdd(s, {}, [])).toEqual({ kind: 'none' });
});

it('reads all 25 ordered suggestions from a run', () => {
  const suggestions = Array.from({ length: 26 }, (_, i) => ({ name: `Person ${i}`, field: 'email', value: `person${i}@acme.com`, label: 'Review' }));
  expect(readDeepFindDetails({ suggestions }).suggestions).toEqual(suggestions.slice(0, 25).map(s => ({ name: s.name, value: s.value, label: s.label })));
});
