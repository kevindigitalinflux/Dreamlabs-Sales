import { expect, it, vi } from 'vitest';
import { classifyMailProvider, lookupMx, cachedMailProvider } from '../../supabase/functions/_shared/dnsLookup';
import { rankedEmailCandidates, unverifiedEmailSuggestions, providerGuessLine, groundedFormatSamples } from '../../supabase/functions/_shared/personEmailFinding';
import { inferDomainPattern } from '../../supabase/functions/_shared/domainPattern';
import { companyDomainHunterCap } from '../../supabase/functions/_shared/deepFindEffort';

it.each([
  ['1 aspmx.l.google.com.', 'google'], ['0 acme-com.mail.protection.outlook.com.', 'microsoft'],
  ['10 mx.zoho.eu.', 'hosted'], ['10 mx1.mimecast.com.', 'hosted'], ['10 mx.private.org.', 'unknown'],
])('classifies MX %s', (data, provider) => {
  expect(classifyMailProvider({ Status: 0, Answer: [{ type: 15, data }] })).toBe(provider);
  expect(classifyMailProvider({ Status: 0, Answer: [{ type: 5, data }] })).toBe('unknown');
});
it('retains provider from the existing DNS lookup without a second request', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 15, data: '0 a.mail.protection.outlook.com.' }] })));
  try {
    expect(await lookupMx('ukrmanagement.com')).toBe('mx');
    expect(cachedMailProvider('ukrmanagement.com')).toBe('microsoft');
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { fetcher.mockRestore(); }
});
it('ranks default and public formats; Medium Microsoft guesses remain review-only', () => {
  const candidates = rankedEmailCandidates('Karthik', 'Venkatapuram', 'ukrmanagement.com', null);
  expect(candidates[0]).toBe('karthik.venkatapuram@ukrmanagement.com');
  const pattern = inferDomainPattern('ukrmanagement.com', [{ email: 'karthik@ukrmanagement.com', first: 'Karthik', last: 'Venkatapuram' }], []);
  expect(rankedEmailCandidates('Karthik', 'Venkatapuram', 'ukrmanagement.com', pattern)[0]).toBe('karthik@ukrmanagement.com');
  const suggestions = unverifiedEmailSuggestions('Karthik Venkatapuram', candidates, 'microsoft');
  expect(suggestions.filter(s => s.guess_rank === 'most_likely')).toHaveLength(1);
  expect(suggestions.slice(1).every(s => s.guess_rank === 'other')).toBe(true);
  expect(suggestions.every(s => s.label.includes('unverified'))).toBe(true);
  expect(providerGuessLine('ukrmanagement.com', 'microsoft')).toBe('ukrmanagement.com uses Microsoft 365, where checks are less reliable, so treat any address as a best guess.');
  expect(providerGuessLine('acme.com', 'google')).toBe('acme.com uses Google Workspace, where checks are less reliable, so treat any address as a best guess.');
});
it('accepts only complete domain addresses actually present in grounded evidence', () => {
  expect(groundedFormatSamples('ukrmanagement.com', 'karthik@ukrmanagement.com', [])).toEqual([]);
  expect(groundedFormatSamples('ukrmanagement.com', 'invented@ukrmanagement.com', ['Contact karthik@ukrmanagement.com, info@ukrmanagement.com.evil.org'])).toEqual([{ email: 'karthik@ukrmanagement.com', first: null, last: null }]);
});

it('can learn a separated public format from another named address, excluding role mailboxes', () => {
  expect(inferDomainPattern('example.com', [{ email: 'alex_brown@example.com', first: null, last: null }], [])?.pattern).toBe('{first}_{last}');
  expect(inferDomainPattern('example.com', [{ email: 'customer.service@example.com', first: null, last: null }], [])).toBeNull();
});
it('caps company domain discovery by effort and Custom run share', () => {
  expect(companyDomainHunterCap('medium', true, 60, 10)).toBe(1);
  expect(companyDomainHunterCap('extra_high', true, 60, 10)).toBe(2);
  expect(companyDomainHunterCap('high', false, 60, 10)).toBe(3);
  expect(companyDomainHunterCap('custom', false, 15, 10)).toBe(1);
  expect(companyDomainHunterCap('custom', false, 500, 1)).toBe(12);
});
