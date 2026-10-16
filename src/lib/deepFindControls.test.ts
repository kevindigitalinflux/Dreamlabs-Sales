import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
import { DeepFindCompanyChoice } from '../components/deepfind/DeepFindCompanyChoice';
import { ContactInfo } from '../components/pipeline/LeadPanelSections';
import type { Lead } from '../types';

it('offers None of these beside the original company actions', () => {
  const html = renderToStaticMarkup(createElement(DeepFindCompanyChoice, { leadId: 'lead', candidates: [{ company_number: '12345678', name: 'Example', status: null, address: null }] }));
  expect(html).toContain('None of these / not a UK company');
  expect(html).toContain('Use this company');
});
it('places the labelled country control next to the website field', () => {
  const html = renderToStaticMarkup(createElement(ContactInfo, { lead: { id: 'lead', country: 'IE' } as Lead, onSave: async () => null }));
  expect(html).toContain('Country');
  expect(html).toContain('Ireland');
  expect(html.indexOf('Website')).toBeLessThan(html.indexOf('Country'));
  expect(html.indexOf('Country')).toBeLessThan(html.indexOf('Address'));
});
