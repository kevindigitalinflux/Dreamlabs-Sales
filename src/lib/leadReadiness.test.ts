import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateReadiness, readinessText } from '../../supabase/functions/_shared/leadReadiness';
import * as knownPerson from '../../supabase/functions/_shared/knownPerson';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReadinessBadge } from '../components/pipeline/ReadinessBadge';

const lead = { owner_name: 'Jane Smith', website: 'https://acme.com', email: 'hello@acme.com', country: 'GB' };
const domains = [{ domain: 'acme.com', needs_check: false, sources: ['site_confirms'] }];
const base = { lead, contacts: [], domains, validEmails: ['hello@acme.com'], websiteSuspect: false };
const emailCorroborated = {
  lead: { owner_name: 'Jane Smith', website: 'https://example.com', email: 'person@example.com', country: 'GB' },
  contacts: [], domains: [{ domain: 'example.com', needs_check: false, sources: ['website', 'lead_email', 'contact_email'] }],
  validEmails: ['person@example.com'], websiteSuspect: false,
};
afterEach(() => vi.restoreAllMocks());
describe('lead readiness', () => {
  it('confirms a nonsuspect corporate website corroborated by saved same-domain emails without page-name proof', () => {
    expect(evaluateReadiness({
      lead: { owner_name: 'Jane Smith', website: 'https://www.example.com/gb-en/about/company-index?ref=fixture', email: 'person@example.com', country: 'GB', phone: null },
      contacts: [], validEmails: ['person@example.com'], websiteSuspect: false,
      domains: [{ domain: 'example.com', needs_check: false, sources: ['website', 'lead_email', 'contact_email'] }],
    })).toEqual({ readiness: 'ready', readiness_missing: [] });
  });
  it('requires all three facts for ready', () => expect(evaluateReadiness(base)).toEqual({ readiness: 'ready', readiness_missing: [] }));
  it.each(['lead_email', 'contact_email'])('accepts either same-domain email evidence source: %s', source => {
    expect(evaluateReadiness({ ...base, lead: { ...lead, website: 'https://example.com', email: 'person@example.com' },
      validEmails: ['person@example.com'], domains: [{ domain: 'example.com', needs_check: false, sources: ['website', source] }],
    })).toEqual({ readiness: 'ready', readiness_missing: [] });
  });
  it.each([['website'], ['website_link'], ['web_search'], ['website', 'website_link', 'web_search']])('does not treat uncorroborated sources %j as confirmation', (...sources) => {
    expect(evaluateReadiness({ ...emailCorroborated, domains: [{ ...emailCorroborated.domains[0], sources }] }))
      .toEqual({ readiness: 'almost', readiness_missing: ['confirmed_website'] });
  });
  it('keeps a domain awaiting checks unconfirmed even with site and email evidence', () => {
    expect(evaluateReadiness({ ...emailCorroborated, domains: [{ ...emailCorroborated.domains[0], needs_check: true, sources: ['site_confirms', 'lead_email', 'contact_email'] }] }))
      .toEqual({ readiness: 'almost', readiness_missing: ['confirmed_website'] });
  });
  it('keeps a blocked same-domain website unconfirmed', () => {
    expect(evaluateReadiness({ ...emailCorroborated, lead: { ...emailCorroborated.lead, blocked_domains: ['example.com'] } }))
      .toEqual({ readiness: 'almost', readiness_missing: ['confirmed_website'] });
  });
  it('keeps a directory website unconfirmed despite email evidence', () => {
    // Stub classification so the directory guard is exercised without real website identities in this fixture.
    vi.spyOn(knownPerson, 'isDirectoryDomain').mockReturnValue(true);
    expect(evaluateReadiness(emailCorroborated)).toEqual({ readiness: 'almost', readiness_missing: ['confirmed_website'] });
  });
  it('does not borrow email evidence from a different domain than the saved website', () => {
    expect(evaluateReadiness({ ...emailCorroborated, lead: { ...emailCorroborated.lead, website: 'https://website.example.com' },
      domains: [...emailCorroborated.domains, { domain: 'website.example.com', needs_check: false, sources: ['website'] }],
    })).toEqual({ readiness: 'almost', readiness_missing: ['confirmed_website'] });
  });
  it('keeps a suspect, lookalike website at needs_work despite same-domain email evidence', () => {
    expect(evaluateReadiness({ ...emailCorroborated, websiteSuspect: true }))
      .toEqual({ readiness: 'needs_work', readiness_missing: ['confirmed_website', 'company_match'] });
  });
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
    expect(evaluateReadiness({ ...base, websiteSuspect: true })).toEqual({ readiness: 'needs_work', readiness_missing: ['confirmed_website', 'company_match'] });
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
  it.each([false, true])('renders the shared assessment text in the badge, with pending domain check %s', needs_check => {
    const assessment = evaluateReadiness({ ...emailCorroborated, domains: [{ ...emailCorroborated.domains[0], needs_check }] });
    const reason = readinessText(assessment.readiness, assessment.readiness_missing);
    expect(reason).toBe(needs_check ? 'Almost: no confirmed website' : 'Ready');
    expect(renderToStaticMarkup(createElement(ReadinessBadge, { readiness: assessment.readiness, missing: assessment.readiness_missing }))).toContain(reason);
  });
});
