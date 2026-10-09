import { describe, expect, it } from 'vitest';
import { ALREADY_ENROLLED_MESSAGE, enrollErrorMessage, isUniqueViolation } from '../../supabase/functions/_shared/enrollmentErrors';

describe('enrollment error mapping', () => {
  it('detects unique violations only', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '42501' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
  });
  it('maps messages', () => {
    expect(enrollErrorMessage({ code: '23505', message: 'duplicate key value' })).toBe(ALREADY_ENROLLED_MESSAGE);
    expect(enrollErrorMessage({ code: '42501', message: 'denied' })).toBe('denied');
    expect(enrollErrorMessage({})).toBe('Could not enrol the lead');
  });
});
