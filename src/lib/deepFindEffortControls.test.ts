import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('../components/deepfind/HunterAllowanceLine', () => ({ HunterAllowanceLine: () => null }));
import { DeepFindConfirm } from '../components/deepfind/DeepFindConfirm';
import { DeepFindCompanyChoice } from '../components/deepfind/DeepFindCompanyChoice';
const props = { leadCount: 25, hunterCap: '60', aiCap: '25', onHunterCap: () => {}, onAiCap: () => {}, capError: null };
it('uses singular lead in one-lead totals', () => {
  expect(renderToStaticMarkup(createElement(DeepFindConfirm, { ...props, leadCount: 1 }))).toContain('For 1 lead:');
});
it('defaults to Medium radio cards with totals and daily allowance explanations', () => {
  const html = renderToStaticMarkup(createElement(DeepFindConfirm, props));
  expect(html.match(/type="radio"/g)).toHaveLength(4);
  expect(html).toMatch(/checked=""[^>]*value="medium"|value="medium"[^>]*checked=""/);
  expect(html).toContain('For 25 leads: up to 25 Hunter credits, 50 AI calls, 25 Firecrawl pages, 25 browser scrapes');
  expect(html).toContain('150 checks per organisation');
  expect(html).not.toContain('inputMode="numeric"');
});
it('Custom retains numeric inputs and whole-run limits', () => {
  const html = renderToStaticMarkup(createElement(DeepFindConfirm, { ...props, effort: 'custom' }));
  expect(html.match(/inputMode="numeric"/g)).toHaveLength(2);
  expect(html).toContain('Hunter credits (max 500)');
});
it('shows Most likely with reasons and disables inactive candidates', () => {
  const html = renderToStaticMarkup(createElement(DeepFindCompanyChoice, { leadId: 'lead', candidates: [
    { company_number: '13550006', name: 'BK', status: 'active', address: null, why: 'exact name, active, your website shows 13550006' },
    { company_number: '13550007', name: 'BK Old', status: 'dissolved', address: null },
  ] }));
  expect(html).toContain('Most likely');
  expect(html).toContain('your website shows 13550006');
  expect(html.match(/disabled=""/g)).toHaveLength(1);
  expect(html).toContain('None of these / not a UK company');
});
