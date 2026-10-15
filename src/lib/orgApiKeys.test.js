import { afterEach, expect, it, vi } from 'vitest';
import { resolveOrgApiKey, resolveOrgWorkerConfig } from '../../supabase/functions/_shared/orgApiKeys';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function fixture({ configured = false, value = null, fallback = true, error = null } = {}) {
  const env = vi.fn(() => 'fake-global-must-not-be-read');
  vi.stubGlobal('Deno', { env: { get: env } });
  const rpc = vi.fn(async () => ({ data: value, error }));
  const from = vi.fn((table) => {
    const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: { is_configured: configured }, error }),
      single: async () => ({ data: table === 'organizations' ? { use_global_api_fallback: fallback } : null, error }),
    };
    return query;
  });
  return { env, rpc, from, service: { from, rpc } };
}
it('never reads a global key for Firecrawl, even when fallback is on or Vault is unavailable', async () => {
  for (const configured of [false, true]) {
    const f = fixture({ configured });
    expect(await resolveOrgApiKey(f.service, 'org', 'firecrawl')).toBeNull();
    expect(f.env).not.toHaveBeenCalled();
    expect(f.from).not.toHaveBeenCalledWith('organizations');
  }
});
it('returns an organisation Firecrawl key only through the org-scoped Vault RPC', async () => {
  const f = fixture({ configured: true, value: 'fake-own' });
  expect(await resolveOrgApiKey(f.service, 'org', 'firecrawl')).toBe('fake-own');
  expect(f.rpc).toHaveBeenCalledWith('app_get_org_api_key', { target_org: 'org', target_provider: 'firecrawl' });
  expect(f.env).not.toHaveBeenCalled();
});
it('actual worker resolver fails closed and logs no raw database errors', async () => {
  const f = fixture({ error: new Error('private-test-error') });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(await resolveOrgWorkerConfig(f.service, 'org')).toBeNull();
  expect(f.env).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toContain('private-test-error');
});
