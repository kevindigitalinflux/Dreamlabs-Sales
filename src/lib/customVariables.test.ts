import { describe, expect, it } from 'vitest';
import { applyCustomVariables, slugifyVariableKey, validateVariableKey } from './customVariables';

describe('slugifyVariableKey', () => {
  it('turns a label into a valid placeholder name', () => {
    expect(slugifyVariableKey('Google Meet link')).toBe('google_meet_link');
    expect(slugifyVariableKey('  My  Calendly -- URL! ')).toBe('my_calendly_url');
    expect(slugifyVariableKey('123 phone')).toBe('phone');
    expect(slugifyVariableKey('???')).toBe('');
    expect(slugifyVariableKey('x'.repeat(80)).length).toBe(40);
  });
});

describe('validateVariableKey', () => {
  it('accepts a good name and explains each way a name can be refused', () => {
    expect(validateVariableKey('google_meet_link')).toBeNull();
    expect(validateVariableKey('')).toMatch(/name/);
    expect(validateVariableKey('Google Meet')).toMatch(/lowercase/);
    expect(validateVariableKey('first_name')).toMatch(/already built in/);
    expect(validateVariableKey('meet', ['meet'])).toMatch(/already have/);
  });

  it('lets a user define the built-ins nothing fills yet', () => {
    expect(validateVariableKey('cal_link')).toBeNull();
    expect(validateVariableKey('audit_date')).toBeNull();
  });
});

describe('applyCustomVariables', () => {
  it('adds new placeholders and fills blank ones, but never overrides a built-in that has a value', () => {
    const vars = { first_name: 'Ana', cal_link: null, pain_point: '', business_name: 'Shiny' };
    const merged = applyCustomVariables(vars, { google_meet_link: 'https://meet.google.com/abc', cal_link: 'https://cal.com/x', first_name: 'HACKED' });
    expect(merged.google_meet_link).toBe('https://meet.google.com/abc');
    expect(merged.cal_link).toBe('https://cal.com/x');
    expect(merged.first_name).toBe('Ana');
  });

  it('does not mutate the input map', () => {
    const vars = { cal_link: null };
    applyCustomVariables(vars, { cal_link: 'x' });
    expect(vars.cal_link).toBeNull();
  });
});
