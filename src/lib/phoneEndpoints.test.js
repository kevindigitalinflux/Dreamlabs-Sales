// Real endpoint handlers; in-memory database/provider boundaries only. Network is forbidden in this suite.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('npm:@supabase/supabase-js@2', () => ({ createClient: vi.fn() }));
vi.mock('../../supabase/functions/_shared/apolloPeopleSearch', () => ({ revealApolloPerson: vi.fn() }));
import { createClient } from 'npm:@supabase/supabase-js@2';
import { revealApolloPerson } from '../../supabase/functions/_shared/apolloPeopleSearch';
import { computeWebhookToken } from '../../supabase/functions/_shared/webhookToken';

let row, handler, configured, canSee, writes, client, failWrite, vaultError;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  configured = true; canSee = true; failWrite = false; vaultError = false; writes = [];
  row = { id: 'person', lead_id: 'lead', source: 'manual', kind: 'person', apollo_person_id: null,
    first_name: 'Jane', last_name: 'Smith', name_obfuscated: false, dismissed_at: null, phone: null, phone_status: 'not_requested',
    leads: { id: 'lead', org_id: 'org', website: 'https://acme.test', country: 'GB', phone_meta: {} } };
  vi.stubGlobal('Deno', { serve: fn => { handler = fn; }, env: { get: name => name === 'SUPABASE_URL' ? 'http://127.0.0.1:54321' : 'local-test-placeholder' } });
  vi.stubGlobal('fetch', () => { throw new Error('Network forbidden'); });
  revealApolloPerson.mockResolvedValue({ firstName: 'Jane', lastName: 'Smith', email: null });
  client = { auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) }, rpc: vi.fn(async () => ({ data: 'dummy-org-key', error: vaultError ? {} : null })), from(table) {
    let patch; const filters = [];
    const result = () => {
      const data = table === 'decision_maker_candidates' ? row : table === 'org_api_settings' ? { is_configured: configured }
        : table === 'org_members' ? { role: 'contractor' } : table === 'leads' ? canSee ? row.leads : null : null;
      if (patch) {
        const target = table === 'leads' ? row.leads : row;
        const matches = filters.every(([key, value]) => target[key] === value);
        if (failWrite) return { data: null, error: { message: 'dummy failure' } };
        if (!matches) return { data: null, error: null };
        writes.push({ ...patch }); Object.assign(target, patch);
      }
      return { data: data ? { ...data } : null, error: null };
    };
    const q = { select: () => q, eq: (k,v) => { filters.push([k,v]); return q; }, is: (k,v) => { filters.push([k,v]); return q; },
      update: p => { patch = p; return q; }, maybeSingle: async () => result(), single: async () => result(), then: resolve => resolve(result()) };
    return q;
  } };
  createClient.mockReturnValue(client);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const reveal = body => handler(new Request('http://local.test/reveal', { method: 'POST', headers: { Authorization: 'Bearer dummy', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
async function callback(numbers) {
  const token = await computeWebhookToken('local-test-placeholder', 'person');
  return handler(new Request(`http://local.test/callback?candidate_id=person&token=${token}`, { method: 'POST', body: JSON.stringify({ people: [{ phone_numbers: numbers }] }) }));
}
it('does not spend without an explicit phone request, own key, or lead visibility', async () => {
  await import('../../supabase/functions/reveal-decision-maker/index');
  expect((await reveal({ candidate_id: 'person' })).status).toBe(400);
  configured = false;
  expect((await reveal({ candidate_id: 'person', reveal_phone: true })).status).toBe(400);
  configured = true; canSee = false;
  expect((await reveal({ candidate_id: 'person', reveal_phone: true })).status).toBe(404);
  expect(revealApolloPerson).not.toHaveBeenCalled();
});
it('reserves one person click before spending and rejects a duplicate', async () => {
  await import('../../supabase/functions/reveal-decision-maker/index');
  expect((await reveal({ candidate_id: 'person', reveal_phone: true })).status).toBe(200);
  expect(revealApolloPerson).toHaveBeenCalledTimes(1);
  expect(revealApolloPerson.mock.calls[0][0]).toEqual({ firstName: 'Jane', lastName: 'Smith', domain: 'acme.test' });
  expect(row.phone_status).toBe('pending');
  expect((await reveal({ candidate_id: 'person', reveal_phone: true })).status).toBe(409);
  expect(revealApolloPerson).toHaveBeenCalledTimes(1);
});
it('fails closed on Vault failure and permits an explicit retry after provider failure', async () => {
  await import('../../supabase/functions/reveal-decision-maker/index');
  vaultError = true;
  expect((await reveal({ candidate_id: 'person', reveal_phone: true })).status).toBe(400);
  expect(revealApolloPerson).not.toHaveBeenCalled();
  vaultError = false; revealApolloPerson.mockResolvedValueOnce(null);
  expect((await reveal({ candidate_id: 'person', reveal_phone: true })).status).toBe(502);
  expect(row.phone_status).toBe('failed');
  expect((await reveal({ candidate_id: 'person', reveal_phone: true })).status).toBe(200);
});
it('saves normalized Apollo metadata only for a pending blank phone and ignores duplicate callbacks', async () => {
  await import('../../supabase/functions/apollo-phone-webhook/index');
  row.phone_status = 'pending';
  expect((await callback([{ raw_number: '07911 123456', type_cd: 'mobile' }])).status).toBe(200);
  expect(row).toMatchObject({ phone: '+447911123456', phone_kind: 'mobile', phone_source: 'apollo', phone_status: 'revealed' });
  expect(row.leads.phone_meta['+447911123456']).toMatchObject({ original: '07911 123456', source: 'apollo' });
  const before = writes.length;
  await callback([{ raw_number: '020 7946 0958' }]);
  expect(writes).toHaveLength(before);
  expect(row.phone).toBe('+447911123456');
});
it('a callback never overwrites a manually filled phone or a dismissed person', async () => {
  await import('../../supabase/functions/apollo-phone-webhook/index');
  row.phone_status = 'pending'; row.phone = '+442079460958';
  await callback([{ raw_number: '07911 123456' }]);
  row.phone = null; row.dismissed_at = 'now';
  await callback([{ raw_number: '07911 123456' }]);
  expect(writes).toEqual([]);
});
