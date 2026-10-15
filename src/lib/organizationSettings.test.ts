import { beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../hooks/useOrgApiSettings', () => ({ useOrgApiSettings: vi.fn() }));
vi.mock('../hooks/useOrg', () => ({ useOrg: vi.fn() }));
import { useOrgApiSettings } from '../hooks/useOrgApiSettings';
import { useOrg } from '../hooks/useOrg';
import { OrganizationSettings } from '../pages/OrganizationSettings';
beforeEach(() => {
  vi.mocked(useOrg).mockReturnValue({ currentOrg: { id: 'org', role: 'admin', name: 'Example' } } as ReturnType<typeof useOrg>);
  vi.mocked(useOrgApiSettings).mockReturnValue({ settings: [{ provider: 'firecrawl', is_configured: true }], loading: false,
    save: vi.fn(), refresh: vi.fn(), workerHost: null, sharedWorker: false, removeWorker: vi.fn(), removeFirecrawl: vi.fn(), loadError: null });
});
it('offers key removal for a configured Firecrawl key to the org admin', () => {
  expect(renderToStaticMarkup(createElement(OrganizationSettings))).toContain('aria-label="Remove Firecrawl key"');
});
it('does not offer Firecrawl management to a contractor', () => {
  vi.mocked(useOrg).mockReturnValue({ currentOrg: { id: 'org', role: 'contractor', name: 'Example' } } as ReturnType<typeof useOrg>);
  expect(renderToStaticMarkup(createElement(OrganizationSettings))).not.toContain('Remove Firecrawl key');
});
it('does not offer removal when no Firecrawl key is configured', () => {
  vi.mocked(useOrgApiSettings).mockReturnValue({ ...useOrgApiSettings(), settings: [] });
  expect(renderToStaticMarkup(createElement(OrganizationSettings))).not.toContain('Remove Firecrawl key');
});
