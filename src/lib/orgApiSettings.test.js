// Exercise the real endpoint with fake clients only; no credentials or network.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('npm:@supabase/supabase-js@2', () => ({ createClient: vi.fn() }));
vi.mock('../../supabase/functions/_shared/workerConfig', async (original) => ({
  ...await original(), validateWorkerConnection: vi.fn(async () => null),
}));
vi.mock('../../supabase/functions/_shared/firecrawlClient', () => ({ validateFirecrawlKey: vi.fn(async () => null) }));
import { createClient } from 'npm:@supabase/supabase-js@2';
import { validateWorkerConnection } from '../../supabase/functions/_shared/workerConfig';
import { validateFirecrawlKey } from '../../supabase/functions/_shared/firecrawlClient';

let handler, rpc, updates, member, platformRole, validationError, fallback, sharedIds;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  fallback = true; sharedIds = '';
  member = 'admin'; platformRole = null; validationError = null;
  rpc = vi.fn(async (name) => ({ data: name === 'app_get_org_api_key' ? 'https://own.example.com|fake-test-only' : null, error: null }));
  updates = vi.fn(async () => ({ error: null }));
  vi.stubGlobal('Deno', { env: { get: (name) => name === 'WORKER_SHARED_ORG_IDS' ? sharedIds : undefined }, serve: (fn) => { handler = fn; } });
  vi.mocked(createClient).mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) }, rpc,
    from(table) {
      const query = { select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: member ? { role: member } : null }),
        single: async () => ({ data: table === 'profiles' ? { platform_role: platformRole } : { use_global_api_fallback: fallback } }),
        update: (value) => { updates(value); return query; }, upsert: updates,
        then: (resolve) => resolve({ data: [{ provider: 'lookup_worker', is_configured: true }], error: null }),
      };
      return query;
    },
  });
  vi.mocked(validateWorkerConnection).mockImplementation(async () => validationError);
  vi.mocked(validateFirecrawlKey).mockImplementation(async () => validationError);
  await import('../../supabase/functions/org-api-settings/index');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const request = (body) => handler(new Request('https://local.test', { method: 'POST', body: JSON.stringify({ org_id: 'org', ...body }) }));

it('validates a Places New key with IDs only before the unchanged Vault save', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ places: [] }))));
  expect((await request({ action: 'save', provider: 'google_places', api_key: 'fake-new-places' })).status).toBe(200);
  expect(fetch.mock.calls[0][0]).toBe('https://places.googleapis.com/v1/places:searchText');
  expect(fetch.mock.calls[0][1].headers['X-Goog-FieldMask']).toBe('places.id');
  expect(rpc).toHaveBeenCalledWith('app_set_org_api_key', { target_org: 'org', target_provider: 'google_places', secret: 'fake-new-places' });
});
it('refuses Places quota errors before Vault and never echoes raw Google text', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'fake-secret https://bad?key=fake-secret' } }), { status: 429 })));
  const response = await request({ action: 'save', provider: 'google_places', api_key: 'fake-secret' });
  expect(response.status).toBe(400);
  const body = JSON.stringify(await response.json());
  expect(body).toContain('quota');
  expect(body).not.toContain('fake-secret');
  expect(rpc).not.toHaveBeenCalled();
});

it('returns only host and status, never the saved worker credential', async () => {
  const response = await request({ action: 'get' });
  const data = await response.json();
  expect(data).toMatchObject({ worker_host: 'own.example.com', use_global_api_fallback: true });
  expect(JSON.stringify(data)).not.toContain('fake-test-only');
});
it.each([null, 'contractor'])('prevents worker save and remove for role %s before validation or Vault', async (role) => {
  member = role;
  expect((await request({ action: 'save', provider: 'lookup_worker', api_key: 'https://own.example.com|fake' })).status).toBe(403);
  expect((await request({ action: 'remove', provider: 'lookup_worker' })).status).toBe(403);
  expect(validateWorkerConnection).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});
it('does not save a connection when health validation fails', async () => {
  validationError = 'The worker rejected the connection.';
  expect((await request({ action: 'save', provider: 'lookup_worker', api_key: 'https://own.example.com|fake' })).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled(); expect(updates).not.toHaveBeenCalled();
});
it('validates before storing in Vault, and returns no credential', async () => {
  const response = await request({ action: 'save', provider: 'lookup_worker', api_key: 'https://own.example.com|fake' });
  expect(await response.json()).toEqual({ ok: true });
  expect(rpc).toHaveBeenCalledWith('app_set_org_api_key', { target_org: 'org', target_provider: 'lookup_worker', secret: 'https://own.example.com|fake' });
  expect(validateWorkerConnection.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
});
it('removes by clearing Vault and disabling the configured flag', async () => {
  expect((await request({ action: 'remove', provider: 'lookup_worker' })).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('app_set_org_api_key', { target_org: 'org', target_provider: 'lookup_worker', secret: '' });
  expect(updates).toHaveBeenCalledWith(expect.objectContaining({ is_configured: false }));
});
it('excludes platform admins without org admin membership from worker management and host disclosure', async () => {
  member = null; platformRole = 'platform_admin';
  expect((await request({ action: 'save', provider: 'lookup_worker', api_key: 'https://own.example.com|fake' })).status).toBe(403);
  expect((await request({ action: 'remove', provider: 'lookup_worker' })).status).toBe(403);
  expect((await (await request({ action: 'get' })).json()).worker_host).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
});
it('validates a Firecrawl key before storing, without returning the key', async () => {
  const result = await request({ action: 'save', provider: 'firecrawl', api_key: 'fake-firecrawl' });
  expect(await result.json()).toEqual({ ok: true });
  expect(validateFirecrawlKey).toHaveBeenCalledExactlyOnceWith('fake-firecrawl');
  expect(rpc).toHaveBeenCalledWith('app_set_org_api_key', { target_org: 'org', target_provider: 'firecrawl', secret: 'fake-firecrawl' });
});
it('rejects invalid Firecrawl keys without saving or returning raw provider text', async () => {
  validationError = 'Firecrawl rejected the key. Check it and try again.';
  const result = await request({ action: 'save', provider: 'firecrawl', api_key: 'fake-firecrawl' });
  expect(result.status).toBe(400); expect(rpc).not.toHaveBeenCalled();
});
it.each(['contractor', null])('rejects Firecrawl management by role %s, including platform-only override', async (role) => {
  member = role; platformRole = 'platform_admin';
  expect((await request({ action: 'save', provider: 'firecrawl', api_key: 'fake-firecrawl' })).status).toBe(403);
  expect((await request({ action: 'remove', provider: 'firecrawl' })).status).toBe(403);
  expect(validateFirecrawlKey).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});

it.each([[' 87da102c-0e27-45e6-8bea-e2609fe80c12 ', true], ['junk', false]])('reports worker-only shared access without changing the paid fallback flag: %s', async (list, allowed) => {
  fallback = false; sharedIds = list;
  const response = await handler(new Request('https://local.test', { method: 'POST', body: JSON.stringify({ action: 'get', org_id: '87da102c-0e27-45e6-8bea-e2609fe80c12' }) }));
  const data = await response.json();
  expect(data.use_global_api_fallback).toBe(false);
  expect(data.shared_worker_allowed).toBe(allowed);
});

it('lets an org admin remove Firecrawl by clearing Vault before disabling metadata', async () => {
  const result = await request({ action: 'remove', provider: 'firecrawl' });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ ok: true });
  expect(rpc).toHaveBeenCalledWith('app_set_org_api_key', { target_org: 'org', target_provider: 'firecrawl', secret: '' });
  expect(updates).toHaveBeenCalledWith(expect.objectContaining({ is_configured: false }));
  expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(updates.mock.invocationCallOrder[0]);
  expect(validateFirecrawlKey).not.toHaveBeenCalled();
});
it('does not disable Firecrawl metadata if clearing Vault fails', async () => {
  rpc.mockResolvedValue({ error: { message: 'private-key' }, data: null });
  const result = await request({ action: 'remove', provider: 'firecrawl' });
  expect(result.status).toBe(500);
  expect(JSON.stringify(await result.json())).not.toContain('private-key');
  expect(updates).not.toHaveBeenCalled();
});
