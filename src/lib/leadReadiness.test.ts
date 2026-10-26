import { describe, expect, it } from 'vitest';
import { evaluateReadiness, readinessText } from '../../supabase/functions/_shared/leadReadiness';

const lead = { owner_name: 'Jane Smith', website: 'https://acme.com', email: 'hello@acme.com', country: 'GB' };
const domains = [{ domain: 'acme.com', needs_check: false, sources: ['site_confirms'] }];
const base = { lead, contacts: [], domains, validEmails: ['hello@acme.com'], websiteSuspect: false };
describe('lead readiness', () => {
  it('requires all three facts for ready', () => expect(evaluateReadiness(base)).toEqual({ readiness: 'ready', readiness_missing: [] }));
  it.each([
    [{ lead: { ...lead, owner_name: null } }, 'decision_maker'],
    [{ validEmails: [] }, 'verified_email'],
    [{ domains: [] }, 'confirmed_website'],
  ])('names the single missing fact', (patch, missing) => {
    expect(evaluateReadiness({ ...base, ...patch })).toEqual({ readiness: 'almost', readiness_missing: [missing] });
  });
  it('needs work when two facts are missing', () => {
    expect(evaluateReadiness({ ...base, validEmails: [], domains: [] }).readiness).toBe('needs_work');
  });
  it('a saved website or MX-only domain is not confirmation', () => {
    expect(evaluateReadiness({ ...base, domains: [{ ...domains[0], sources: ['mx'] }] }).readiness_missing).toContain('confirmed_website');
  });
  it('a verified suggestion cannot substitute for an email saved on the lead or contact', () => {
    expect(evaluateReadiness({ ...base, validEmails: ['other@acme.com'] }).readiness_missing).toContain('verified_email');
  });
  it('any live named contact with a role qualifies, including manual contacts', () => {
    expect(evaluateReadiness({ ...base, lead: { ...lead, owner_name: null }, contacts: [{ first_name: 'Deborah', last_name: 'Garner', title: 'HR', email: 'HELLO@acme.com' }] }).readiness).toBe('ready');
  });
  it.each([{ dismissed_at: '2026-10-26' }, { name_obfuscated: true }, { kind: 'general' }, { last_name: 'S.' }, { title: '' }])('rejects an unqualified contact', patch => {
    const contact = { first_name: 'Jane', last_name: 'Smith', title: 'Director', ...patch };
    expect(evaluateReadiness({ ...base, lead: { ...lead, owner_name: null }, contacts: [contact] }).readiness_missing).toContain('decision_maker');
  });
  it('a dismissed contact email does not establish verification', () => {
    expect(evaluateReadiness({ ...base, lead: { ...lead, email: null }, contacts: [{ email: lead.email, dismissed_at: 'date' }] }).readiness_missing).toContain('verified_email');
  });
  it('wrong website overrides otherwise ready', () => {
    expect(evaluateReadiness({ ...base, websiteSuspect: true })).toEqual({ readiness: 'needs_work', readiness_missing: ['company_match'] });
  });
  it.each(['+353 1 234 5678', '(212) 555-0198'])('GB foreign number flags company mismatch: %s', phone => {
    const value = phone.startsWith('(') ? '+1 212 555 0198' : phone;
    expect(evaluateReadiness({ ...base, lead: { ...lead, phone: value } }).readiness_missing).toContain('company_match');
  });
  it('checks additional phones but ignores malformed numbers and historical metadata', () => {
    expect(evaluateReadiness({ ...base, lead: { ...lead, additional_phones: ['+35312345678'] } }).readiness).toBe('needs_work');
    const withHistory = { ...lead, phone: '2026-10-26', phone_meta: { '+35312345678': {} } };
    expect(evaluateReadiness({ ...base, lead: withHistory }).readiness).toBe('ready');
  });
  it('foreign phone override only applies to explicit GB leads', () => {
    expect(evaluateReadiness({ ...base, lead: { ...lead, country: 'IE', phone: '+35312345678' } }).readiness).toBe('ready');
  });
  it('gives readable reasons and a null label', () => {
    expect(readinessText(null)).toBe('Not checked');
    expect(readinessText('almost', ['verified_email'])).toBe('Almost: no verified email');
    expect(readinessText('needs_work', ['company_match'])).toContain('company match needs checking');
  });
});
