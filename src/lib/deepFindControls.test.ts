import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
import { DeepFindCompanyChoice } from '../components/deepfind/DeepFindCompanyChoice';
import { ContactInfo } from '../components/pipeline/LeadPanelSections';
import type { Lead } from '../types';
import { AutoChangeRows } from '../components/deepfind/DeepFindAutoChanges';
import { AdditionalDetails } from '../components/pipeline/AdditionalDetails';

it('offers None of these beside the original company actions', () => {
  const html = renderToStaticMarkup(createElement(DeepFindCompanyChoice, { leadId: 'lead', candidates: [{ company_number: '12345678', name: 'Example', status: null, address: null }] }));
  expect(html).toContain('None of these / not a UK company');
  expect(html).toContain('Use this company');
  expect(html).toContain('aria-expanded="false"');
  expect(html.indexOf('None of these / not a UK company')).toBeLessThan(html.indexOf('<ul'));
  expect(html).toContain('Not a UK company, or your company is not listed?');
  expect(html).toMatch(/bg-violet[^>]*>None of these/);
});
it('places the labelled country control next to the website field', () => {
  const html = renderToStaticMarkup(createElement(ContactInfo, { lead: { id: 'lead', country: 'IE' } as Lead, onSave: async () => null }));
  expect(html).toContain('Country');
  expect(html).toContain('Ireland');
  expect(html.indexOf('Website')).toBeLessThan(html.indexOf('Country'));
  expect(html.indexOf('Country')).toBeLessThan(html.indexOf('Address'));
});
it('renders scheme-free websites as external links and leaves junk additional websites as text', () => {
  const lead = { id: 'lead', website: 'ux-tree.com', additional_websites: ['other.com', 'javascript:alert(1)'] } as Lead;
  const html = renderToStaticMarkup(createElement(ContactInfo, { lead, onSave: async () => null }));
  expect(html).toContain('href="https://ux-tree.com/"');
  expect(html).toContain('href="https://other.com/"');
  expect(html).toContain('rel="noreferrer noopener"');
  expect(html).not.toContain('href="javascript:');
  expect(renderToStaticMarkup(createElement(AdditionalDetails, { lead, onSave: async () => null }))).toContain('javascript:alert(1)');
});
it('shows automatic changes with individual labelled Undo actions and a concurrency notice', () => {
  const html = renderToStaticMarkup(createElement(AutoChangeRows, { changes: [
    { table: 'leads', id: 'lead', field: 'website', before: null, after: 'https://acme.com' },
    { table: 'decision_maker_candidates', id: 'c', field: 'linkedin_url', before: null, after: 'https://www.linkedin.com/in/jane' },
  ], busy: false, notices: { 1: 'Changed since, left as is' }, onUndo: () => {} }));
  expect(html).toContain('Deep find changed these automatically');
  expect(html.match(/>Undo<\/button>/g)).toHaveLength(2);
  expect(html).toContain('Changed since, left as is');
  expect(html.match(/disabled=""/g)).toHaveLength(1);
  expect(html).toContain('aria-label="Undo website change: blank to https://acme.com"');
});
