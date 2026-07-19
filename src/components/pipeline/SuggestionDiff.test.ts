import { describe, expect, it } from 'vitest';
import { sanitizeSuggestion } from './SuggestionDiff';

describe('sanitizeSuggestion', () => {
  it('passes a fully valid suggestion through unchanged', () => {
    const raw = {
      stage: 'negotiating',
      package_tier: 'ai_foundation',
      deal_value: 3000,
      next_action_date: '2026-07-24',
      next_action_note: 'Call Friday to confirm',
      pain_point: 'Manual bookings',
      rationale: 'Note confirms package and price.',
    };
    expect(sanitizeSuggestion(raw)).toEqual(raw);
  });

  it('drops an out-of-whitelist stage but keeps the rest', () => {
    const clean = sanitizeSuggestion({ stage: 'DROP TABLE leads', deal_value: 500, rationale: 'r' });
    expect(clean).toEqual({ deal_value: 500, rationale: 'r' });
  });

  it('drops malformed or impossible next_action_date values', () => {
    expect(sanitizeSuggestion({ next_action_date: 'next Friday', rationale: 'r' })).toEqual({ rationale: 'r' });
    expect(sanitizeSuggestion({ next_action_date: '2026-13-45', rationale: 'r' })).toEqual({ rationale: 'r' });
  });

  it('drops non-numeric, negative, and non-finite deal_value', () => {
    expect(sanitizeSuggestion({ deal_value: '3000', rationale: 'r' })).toEqual({ rationale: 'r' });
    expect(sanitizeSuggestion({ deal_value: -1, rationale: 'r' })).toEqual({ rationale: 'r' });
    expect(sanitizeSuggestion({ deal_value: Infinity, rationale: 'r' })).toEqual({ rationale: 'r' });
  });

  it('defaults a missing rationale and truncates long strings to 500 chars', () => {
    const clean = sanitizeSuggestion({ pain_point: 'x'.repeat(600) });
    expect(clean?.rationale).toBe('AI suggestion');
    expect(clean?.pain_point).toHaveLength(500);
  });

  it('returns null for non-object input', () => {
    expect(sanitizeSuggestion(null)).toBeNull();
    expect(sanitizeSuggestion('nope')).toBeNull();
  });
});
