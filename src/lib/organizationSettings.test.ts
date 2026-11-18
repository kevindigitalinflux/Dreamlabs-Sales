import {useApiKeyHealth} from '../hooks/useApiKeyHealth';
vi.mock('../hooks/useApiKeyHealth',()=>({useApiKeyHealth:vi.fn(()=>({rows:[],loading:false,error:null,refresh:vi.fn()}))}));
import {MemoryRouter} from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../hooks/useOrgApiSettings', () => ({ useOrgApiSettings: vi.fn() }));
vi.mock('../hooks/useOrg', () => ({ useOrg: vi.fn() }));
// Folding is not under test here: render every section's content so the controls inside can be checked.
vi.mock('../components/ui/Collapsible', () => ({ Collapsible: ({ children }: { children: unknown }) => children }));
import { useOrgApiSettings } from '../hooks/useOrgApiSettings';
import { useOrg } from '../hooks/useOrg';
import { OrganizationSettings } from '../pages/OrganizationSettings';
beforeEach(() => {
  vi.mocked(useApiKeyHealth).mockReturnValue({rows:[],loading:false,error:null,refresh:vi.fn()});
  vi.mocked(useOrg).mockReturnValue({ currentOrg: { id: 'org', role: 'admin', name: 'Example' } } as ReturnType<typeof useOrg>);
  vi.mocked(useOrgApiSettings).mockReturnValue({ settings: [{ provider: 'firecrawl', is_configured: true }], loading: false,
    save: vi.fn(), test: vi.fn(), refresh: vi.fn(), workerHost: null, sharedWorker: false, removeWorker: vi.fn(), removeFirecrawl: vi.fn(), loadError: null });
});
it('offers key removal for a configured Firecrawl key to the org admin', () => {
  expect(renderToStaticMarkup(createElement(MemoryRouter,null,createElement(OrganizationSettings)))).toContain('aria-label="Remove Firecrawl key"');
});
it('does not offer Firecrawl management to a contractor', () => {
  vi.mocked(useOrg).mockReturnValue({ currentOrg: { id: 'org', role: 'contractor', name: 'Example' } } as ReturnType<typeof useOrg>);
  expect(renderToStaticMarkup(createElement(MemoryRouter,null,createElement(OrganizationSettings)))).not.toContain('Remove Firecrawl key');
});
it('does not offer removal when no Firecrawl key is configured', () => {
  vi.mocked(useOrgApiSettings).mockReturnValue({ ...useOrgApiSettings(), settings: [] });
  expect(renderToStaticMarkup(createElement(MemoryRouter,null,createElement(OrganizationSettings)))).not.toContain('Remove Firecrawl key');
});

it('explains New setup, Enterprise free searches, billing guardrails and one Places key slot', () => {
  const markup = renderToStaticMarkup(createElement(MemoryRouter,null,createElement(OrganizationSettings)));
  expect(markup).toContain('Places API (New)');
  expect(markup).toContain('1,000 free monthly searches');
  expect(markup).toContain('Budgets &amp; alerts');
  expect(markup).toContain('Quotas');
  expect(markup).not.toContain('Google Places Pro');
  expect(markup).not.toContain('5,000 free searches');
  expect(markup).toContain('Loading Google search usage');
});

it('shows the shared Gemini health flag on a provider with no saved org key',()=>{
 vi.mocked(useOrgApiSettings).mockReturnValue({...useOrgApiSettings(),settings:[]});
 vi.mocked(useApiKeyHealth).mockReturnValue({rows:[{org_id:'org',provider:'gemini',state:'needs_topup',status_code:402,key_source:'global',feature:'deep_find',first_failed_at:'2026-11-18T10:00:00Z',last_failed_at:'2026-11-18T10:00:00Z',failure_count:1}],loading:false,error:null,refresh:vi.fn()});
 const html=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(OrganizationSettings)));
 expect(html).toContain('id="gemini"');expect(html).toContain('Billing or credit needs attention.');expect(html).toContain('platform owner must fix it');expect(html).toContain('Test current key');
});
